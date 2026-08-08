use std::collections::{HashMap, VecDeque};
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
struct SelectedReadingRegistry {
    entries: HashMap<String, SelectedReadingHandle>,
    insertion_order: VecDeque<String>,
}

#[derive(Default)]
pub(crate) struct SelectedReadingHandles {
    registry: Mutex<SelectedReadingRegistry>,
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
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while selected.entries.len() >= 8 {
            let Some(oldest_key) = selected.insertion_order.pop_front() else {
                break;
            };
            selected.entries.remove(&oldest_key);
        }
        selected.insertion_order.push_back(handle_id.clone());
        selected.entries.insert(
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
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entries
            .get(handle_id)
            .cloned()
            .ok_or_else(|| "Selected reading handle has expired; choose the file again".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::SelectedReadingHandles;
    use std::path::PathBuf;

    #[test]
    fn evicts_the_oldest_handle_and_keeps_capacity_bounded() {
        let handles = SelectedReadingHandles::default();
        let mut registered = Vec::new();

        for index in 0..12 {
            registered.push(
                handles
                    .register(PathBuf::from(format!("reading-{index}.md")), index, None)
                    .expect("register selected reading"),
            );
        }

        for handle in &registered[..4] {
            assert!(handles.get(handle).is_err());
        }
        for (offset, handle) in registered[4..].iter().enumerate() {
            let selected = handles.get(handle).expect("active handle remains available");
            assert_eq!(selected.path, PathBuf::from(format!("reading-{}.md", offset + 4)));
        }

        let registry = handles
            .registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(registry.entries.len(), 8);
        assert_eq!(registry.insertion_order.len(), 8);
    }
}
