use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Clone)]
pub(crate) struct SelectedReadingHandle {
    pub(crate) path: PathBuf,
    pub(crate) size: u64,
    pub(crate) modified: Option<SystemTime>,
}

#[derive(Default)]
pub(crate) struct SelectedReadingHandles {
    entries: Mutex<BTreeMap<String, SelectedReadingHandle>>,
}

impl SelectedReadingHandles {
    pub(crate) fn register(
        &self,
        path: PathBuf,
        size: u64,
        modified: Option<SystemTime>,
    ) -> Result<String, String> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|_| "Unable to create a secure local file handle".to_string())?;
        let handle_id = hex::encode(bytes);
        let mut selected = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while selected.len() >= 8 {
            let Some(oldest_key) = selected.keys().next().cloned() else {
                break;
            };
            selected.remove(&oldest_key);
        }
        selected.insert(
            handle_id.clone(),
            SelectedReadingHandle {
                path,
                size,
                modified,
            },
        );
        Ok(handle_id)
    }

    pub(crate) fn get(&self, handle_id: &str) -> Result<SelectedReadingHandle, String> {
        if handle_id.len() != 32 || !handle_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("Selected reading handle is invalid".into());
        }
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(handle_id)
            .cloned()
            .ok_or_else(|| "Selected reading handle has expired; choose the file again".to_string())
    }
}
