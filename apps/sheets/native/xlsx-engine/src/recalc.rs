//! IronCalc-backed formula recalculation (roadmap M3/C2 prototype).
//!
//! Loads the workbook into IronCalc's model, applies pending edits as user
//! input, evaluates, and returns the requested cells' computed values. The
//! caller stays fail-soft: any load or evaluation problem (including panics
//! from IronCalc's strict importer) surfaces as a normal sidecar error and
//! the renderer keeps showing cached values.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use ironcalc::base::Model;
use ironcalc::import::load_from_xlsx;
use serde::{Deserialize, Serialize};

use crate::{CellRange, SidecarError};

pub const MAX_RECALC_EDITS: usize = 10_000;
pub const MAX_RECALC_READ_CELLS: usize = 20_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcEdit {
    pub sheet: String,
    /// 0-based coordinates on the wire (IronCalc itself is 1-based).
    pub row: u32,
    pub column: u32,
    /// User input: `=SUM(A1:A3)`, `42`, `text`; empty clears.
    pub input: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcRead {
    pub sheet: String,
    pub range: CellRange,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcCell {
    pub sheet: String,
    pub row: u32,
    pub column: u32,
    /// Display string after evaluation (number formats applied).
    pub formatted: String,
    /// Raw numeric value when the cell evaluates to a number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<f64>,
    pub is_formula: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcResult {
    pub cells: Vec<RecalcCell>,
}

pub fn recalc_cells(
    path: &Path,
    edits: &[RecalcEdit],
    reads: &[RecalcRead],
) -> Result<RecalcResult, SidecarError> {
    if edits.len() > MAX_RECALC_EDITS {
        return Err(SidecarError::InvalidRequest(format!(
            "Too many recalc edits (limit {MAX_RECALC_EDITS})."
        )));
    }
    let read_cells: usize = reads
        .iter()
        .map(|read| {
            let rows = read.range.end_row.saturating_sub(read.range.start_row) + 1;
            let columns = read.range.end_column.saturating_sub(read.range.start_column) + 1;
            rows.saturating_mul(columns)
        })
        .sum();
    if read_cells > MAX_RECALC_READ_CELLS {
        return Err(SidecarError::InvalidRequest(format!(
            "Recalc read exceeds {MAX_RECALC_READ_CELLS} cells."
        )));
    }
    // IronCalc's importer is strict and can panic on non-Excel producers
    // (missing cellStyles, whitespace nodes); contain that to this request.
    catch_unwind(AssertUnwindSafe(|| run(path, edits, reads))).map_err(|_| {
        SidecarError::Workbook(
            "The formula engine could not process this workbook.".into(),
        )
    })?
}

fn run(
    path: &Path,
    edits: &[RecalcEdit],
    reads: &[RecalcRead],
) -> Result<RecalcResult, SidecarError> {
    let path_text = path
        .to_str()
        .ok_or_else(|| SidecarError::InvalidRequest("Workbook path is not valid UTF-8.".into()))?;
    let mut model = load_from_xlsx(path_text, "en", "UTC", "en")
        .map_err(|error| SidecarError::Workbook(format!("Formula engine import failed: {error}")))?;
    for edit in edits {
        let sheet = sheet_index(&model, &edit.sheet)?;
        model
            .set_user_input(sheet, edit.row as i32 + 1, edit.column as i32 + 1, edit.input.clone())
            .map_err(|error| {
                SidecarError::Workbook(format!("Formula engine rejected an edit: {error}"))
            })?;
    }
    model.evaluate();
    let mut cells = Vec::new();
    for read in reads {
        let sheet = sheet_index(&model, &read.sheet)?;
        for row in read.range.start_row..=read.range.end_row {
            for column in read.range.start_column..=read.range.end_column {
                let row_1 = row as i32 + 1;
                let column_1 = column as i32 + 1;
                let formatted = model
                    .get_formatted_cell_value(sheet, row_1, column_1)
                    .unwrap_or_default();
                let formula = model.get_cell_formula(sheet, row_1, column_1).ok().flatten();
                let is_formula = formula.is_some();
                if formatted.is_empty() && !is_formula {
                    continue;
                }
                // Known engine gaps where the file's cached value beats the
                // error: CELL("filename") is unimplemented (#175) and RATE's
                // Newton solver dies near -100% where Excel converges (#185).
                if formatted.starts_with('#') {
                    if let Some(text) = &formula {
                        let upper = text.to_uppercase();
                        if upper.contains("CELL(") && upper.contains("\"FILENAME\"") {
                            continue;
                        }
                        if formatted == "#NUM!" && upper.contains("RATE(") {
                            continue;
                        }
                    }
                }
                let number = raw_number(&model, sheet, row_1, column_1);
                cells.push(RecalcCell {
                    sheet: read.sheet.clone(),
                    row: row as u32,
                    column: column as u32,
                    formatted,
                    number,
                    is_formula,
                });
            }
        }
    }
    Ok(RecalcResult { cells })
}

fn sheet_index(model: &Model, name: &str) -> Result<u32, SidecarError> {
    model
        .workbook
        .worksheets
        .iter()
        .position(|worksheet| worksheet.name == name)
        .map(|index| index as u32)
        .ok_or_else(|| SidecarError::InvalidRequest(format!("Unknown sheet: {name}")))
}

fn raw_number(model: &Model, sheet: u32, row: i32, column: i32) -> Option<f64> {
    use ironcalc::base::cell::CellValue;
    match model.get_cell_value_by_index(sheet, row, column) {
        Ok(CellValue::Number(value)) => Some(value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ironcalc::export::save_to_xlsx;

    fn fixture(path: &Path) {
        let mut model = Model::new_empty("fixture", "en", "UTC", "en").unwrap();
        model.set_user_input(0, 1, 1, "10".to_string()).unwrap();
        model.set_user_input(0, 2, 1, "20".to_string()).unwrap();
        model.set_user_input(0, 3, 1, "=SUM(A1:A2)".to_string()).unwrap();
        model.evaluate();
        save_to_xlsx(&model, path.to_str().unwrap()).unwrap();
    }

    #[test]
    fn recalculates_after_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recalc.xlsx");
        fixture(&path);
        let result = recalc_cells(
            &path,
            &[RecalcEdit { sheet: "Sheet1".into(), row: 0, column: 0, input: "100".into() }],
            &[RecalcRead {
                sheet: "Sheet1".into(),
                range: CellRange { start_row: 0, end_row: 2, start_column: 0, end_column: 0 },
            }],
        )
        .unwrap();
        let sum = result.cells.iter().find(|cell| cell.row == 2).unwrap();
        assert_eq!(sum.formatted, "120");
        assert_eq!(sum.number, Some(120.0));
        assert!(sum.is_formula);
    }

    #[test]
    fn rejects_unknown_sheets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recalc.xlsx");
        fixture(&path);
        let error = recalc_cells(
            &path,
            &[],
            &[RecalcRead {
                sheet: "Nope".into(),
                range: CellRange { start_row: 0, end_row: 0, start_column: 0, end_column: 0 },
            }],
        )
        .unwrap_err();
        assert!(matches!(error, SidecarError::InvalidRequest(_)));
    }

    #[test]
    fn caps_read_volume() {
        let error = recalc_cells(
            Path::new("/nonexistent.xlsx"),
            &[],
            &[RecalcRead {
                sheet: "Sheet1".into(),
                range: CellRange { start_row: 0, end_row: 999, start_column: 0, end_column: 999 },
            }],
        )
        .unwrap_err();
        assert!(matches!(error, SidecarError::InvalidRequest(_)));
    }
}
