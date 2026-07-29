//! Generic string-length/emptiness validation used by command wrappers to
//! reject malformed IPC input before it reaches domain manager logic.

use crate::shared::error::AppError;

pub fn validate_string(s: &str, max_len: usize, field: &str) -> Result<(), AppError> {
    if s.is_empty() {
        return Err(AppError::Validation(format!("{field} cannot be empty")));
    }
    if s.len() > max_len {
        return Err(AppError::Validation(format!("{field} too long (max {max_len})")));
    }
    Ok(())
}
