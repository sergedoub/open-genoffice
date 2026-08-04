use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use xlsx_sidecar::archive::{
    archive_manifest, read_entries_to_dir, save_archive, scan_entries_for_text, EntryContent,
};
use xlsx_sidecar::recalc::{recalc_cells, RecalcEdit, RecalcRead};
use xlsx_sidecar::{CellRange, SidecarError, WorkbookSessions};

const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum Command {
    Open {
        path: PathBuf,
    },
    ReadRange {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
        range: CellRange,
    },
    Close {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    ReadMedia {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "visualId")]
        visual_id: String,
    },
    ReadFormulaCells {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sheetId")]
        sheet_id: String,
    },
    Cancel {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "targetRequestId")]
        _target_request_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ArchiveManifest {
        path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ReadEntries {
        path: PathBuf,
        entries: Vec<String>,
        output_dir: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    ScanEntries {
        path: PathBuf,
        entries: Vec<String>,
        needle: String,
    },
    #[serde(rename_all = "camelCase")]
    ConvertWorkbook {
        path: PathBuf,
        target_path: PathBuf,
    },
    #[serde(rename_all = "camelCase")]
    SaveArchive {
        source_path: PathBuf,
        target_path: PathBuf,
        replacements: Vec<EntryContent>,
        removals: Vec<String>,
        additions: Vec<EntryContent>,
    },
    #[serde(rename_all = "camelCase")]
    RecalcCells {
        path: PathBuf,
        edits: Vec<RecalcEdit>,
        reads: Vec<RecalcRead>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    version: u8,
    request_id: String,
    #[serde(flatten)]
    command: Command,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    version: u8,
    request_id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = BufWriter::new(stdout.lock());
    let mut sessions = WorkbookSessions::new();

    for line in BufReader::new(stdin.lock()).lines() {
        let response = match line {
            Ok(line) => handle_line(&line, &mut sessions),
            Err(error) => Response::failure(
                String::new(),
                "stdin_error",
                format!("Unable to read sidecar request: {error}"),
            ),
        };
        if serde_json::to_writer(&mut output, &response).is_err()
            || output.write_all(b"\n").is_err()
            || output.flush().is_err()
        {
            break;
        }
    }
}

fn handle_line(line: &str, sessions: &mut WorkbookSessions) -> Response {
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return Response::failure(
                String::new(),
                "invalid_json",
                format!("Invalid sidecar request: {error}"),
            );
        }
    };
    if request.version != PROTOCOL_VERSION {
        return Response::failure(
            request.request_id,
            "unsupported_version",
            "Unsupported sidecar protocol version.".into(),
        );
    }

    let request_id = request.request_id;
    let result = match request.command {
        Command::Open { path } => sessions
            .open(&path)
            .and_then(to_json_value),
        Command::ReadRange {
            session_id,
            sheet_id,
            range,
        } => sessions
            .read_range(&session_id, &sheet_id, &range)
            .and_then(to_json_value),
        Command::Close { session_id } => sessions
            .close(&session_id)
            .and_then(|()| to_json_value(serde_json::json!({ "closed": true }))),
        Command::ReadMedia {
            session_id,
            visual_id,
        } => sessions
            .read_media(&session_id, &visual_id)
            .and_then(to_json_value),
        Command::ReadFormulaCells {
            session_id,
            sheet_id,
        } => sessions
            .read_formula_cells(&session_id, &sheet_id)
            .and_then(to_json_value),
        Command::Cancel {
            session_id,
            _target_request_id: _,
        } => sessions
            .cancel(&session_id)
            .and_then(|()| to_json_value(serde_json::json!({ "cancelled": true }))),
        Command::ConvertWorkbook { path, target_path } => {
            xlsx_sidecar::convert::convert_to_xlsx(&path, &target_path)
                .and_then(|result| to_json_value(serde_json::json!({
                    "sheets": result.sheets,
                    "cells": result.cells,
                })))
        }
        Command::ArchiveManifest { path } => archive_manifest(&path)
            .and_then(|entries| to_json_value(serde_json::json!({ "entries": entries }))),
        Command::ReadEntries {
            path,
            entries,
            output_dir,
        } => read_entries_to_dir(&path, &entries, &output_dir)
            .and_then(|extracted| to_json_value(serde_json::json!({ "entries": extracted }))),
        Command::ScanEntries {
            path,
            entries,
            needle,
        } => scan_entries_for_text(&path, &entries, &needle)
            .and_then(|matches| to_json_value(serde_json::json!({ "matches": matches }))),
        Command::SaveArchive {
            source_path,
            target_path,
            replacements,
            removals,
            additions,
        } => save_archive(&source_path, &target_path, &replacements, &removals, &additions)
            .and_then(to_json_value),
        Command::RecalcCells { path, edits, reads } => recalc_cells(&path, &edits, &reads)
            .and_then(to_json_value),
    };
    match result {
        Ok(value) => Response::success(request_id, value),
        Err(error) => Response::from_error(request_id, error),
    }
}

fn to_json_value<T: Serialize>(value: T) -> Result<Value, SidecarError> {
    serde_json::to_value(value).map_err(SidecarError::from)
}

impl Response {
    fn success(request_id: String, result: Value) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    fn from_error(request_id: String, error: SidecarError) -> Self {
        let code = match error {
            SidecarError::InvalidRequest(_) => "invalid_request",
            SidecarError::Io(_) => "io_error",
            SidecarError::Workbook(_) => "workbook_error",
        };
        Self::failure(request_id, code, error.to_string())
    }

    fn failure(request_id: String, code: &'static str, message: String) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            request_id,
            ok: false,
            result: None,
            error: Some(ErrorBody { code, message }),
        }
    }
}
