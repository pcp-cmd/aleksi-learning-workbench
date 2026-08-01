use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;

pub(crate) const MAX_FAILURE_LOG_BYTES: usize = 4 * 1024;

pub(crate) fn redact_known_secret(text: &str, protocol_secret: Option<&str>) -> String {
    match protocol_secret.filter(|secret| !secret.is_empty()) {
        Some(secret) => text.replace(secret, "[REDACTED]"),
        None => text.to_string(),
    }
}

fn absolute_path_start(characters: &[char], index: usize) -> bool {
    let windows_drive = characters
        .get(index)
        .is_some_and(|character| character.is_ascii_alphabetic())
        && characters.get(index + 1) == Some(&':')
        && matches!(characters.get(index + 2), Some('\\' | '/'));
    let unc = matches!(
        (characters.get(index), characters.get(index + 1)),
        (Some('\\'), Some('\\'))
    );
    let posix = characters.get(index) == Some(&'/')
        && characters.get(index + 1) != Some(&'/')
        && (index == 0
            || characters
                .get(index.wrapping_sub(1))
                .is_some_and(|character| {
                    character.is_whitespace()
                        || matches!(character, '(' | '[' | '{' | '=' | ':' | '"' | '\'')
                }));
    windows_drive || unc || posix
}

pub(crate) fn sanitize_diagnostic_message(text: &str, protocol_secret: Option<&str>) -> String {
    let redacted = redact_known_secret(text, protocol_secret);
    let characters: Vec<char> = redacted.chars().collect();
    let mut sanitized = String::with_capacity(redacted.len());
    let mut index = 0;

    while index < characters.len() {
        let character = characters[index];
        if matches!(character, '"' | '\'')
            && absolute_path_start(&characters, index.saturating_add(1))
        {
            sanitized.push_str("[local path]");
            index += 1;
            while index < characters.len() && characters[index] != character {
                index += 1;
            }
            index = index.saturating_add(1);
            continue;
        }
        if absolute_path_start(&characters, index) {
            sanitized.push_str("[local path]");
            while index < characters.len() && characters[index] != '\n' {
                index += 1;
            }
            continue;
        }
        sanitized.push(character);
        index += 1;
    }

    bounded_utf8_tail(&sanitized, MAX_FAILURE_LOG_BYTES).to_string()
}

pub(crate) fn bounded_utf8_tail(text: &str, maximum: usize) -> &str {
    if text.len() <= maximum {
        return text;
    }
    let mut start = text.len() - maximum;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

pub(crate) fn recent_log_tail(path: &Path, protocol_secret: Option<&str>) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let file_length = file.metadata().ok()?.len();
    let overlap = protocol_secret.map(str::len).unwrap_or_default() as u64;
    let read_length = file_length.min(MAX_FAILURE_LOG_BYTES as u64 + overlap);
    file.seek(SeekFrom::End(-(read_length as i64))).ok()?;
    let mut data = Vec::with_capacity(read_length as usize);
    file.read_to_end(&mut data).ok()?;
    let redacted = redact_known_secret(&String::from_utf8_lossy(&data), protocol_secret);
    let redacted_bytes = redacted.as_bytes();
    let start = redacted_bytes.len().saturating_sub(MAX_FAILURE_LOG_BYTES);
    let text = String::from_utf8_lossy(&redacted_bytes[start..]);
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return None;
    }
    let start_line = lines.len().saturating_sub(6);
    Some(lines[start_line..].join(" | "))
}

pub(crate) fn write_redacted_log(
    reader: impl Read,
    mut output: impl Write,
    protocol_secret: &str,
) -> std::io::Result<()> {
    for line in BufReader::new(reader).lines() {
        let line = line?;
        writeln!(
            output,
            "{}",
            redact_known_secret(&line, Some(protocol_secret))
        )?;
    }
    Ok(())
}
