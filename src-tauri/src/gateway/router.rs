use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

use tauri::Runtime;

/// A boxed, type-erased future returned by a registered handler.
pub type HandlerFuture = Pin<Box<dyn Future<Output = ()> + Send>>;

/// A boxed, type-erased handler for one inbound message type tag.
pub type Handler<R> = Arc<dyn Fn(serde_json::Value, tauri::AppHandle<R>) -> HandlerFuture + Send + Sync>;

/// Registry mapping inbound WebSocket message type tags to domain handlers.
///
/// Domains register handlers for the message types they own (e.g. the
/// friends domain registers `presence_update`, `call_invite`, ...) without
/// the gateway needing to know anything about domain-specific payloads. A
/// future domain (e.g. chat) can register a new type tag without touching
/// gateway code.
///
/// Generic over the Tauri runtime so tests can dispatch through
/// `tauri::test::MockRuntime` instead of the real `Wry` runtime the app
/// uses at runtime (the default type parameter).
pub struct Router<R: Runtime = tauri::Wry> {
    handlers: Arc<RwLock<HashMap<String, Handler<R>>>>,
}

impl<R: Runtime> Clone for Router<R> {
    fn clone(&self) -> Self {
        Self {
            handlers: self.handlers.clone(),
        }
    }
}

impl<R: Runtime> Default for Router<R> {
    fn default() -> Self {
        Self {
            handlers: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl<R: Runtime> Router<R> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers `handler` to be invoked for messages whose `type` field
    /// equals `type_tag`. Registering the same tag twice replaces the
    /// previous handler.
    pub fn register<F, Fut>(&self, type_tag: impl Into<String>, handler: F)
    where
        F: Fn(serde_json::Value, tauri::AppHandle<R>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let wrapped: Handler<R> = Arc::new(move |data, app| Box::pin(handler(data, app)));
        self.handlers
            .write()
            .expect("router lock poisoned")
            .insert(type_tag.into(), wrapped);
    }

    /// Dispatches `data` to the handler registered for `type_tag`, if any.
    /// Returns `true` if a handler was found and invoked, `false` if
    /// `type_tag` has no registered handler.
    pub async fn dispatch(&self, type_tag: &str, data: serde_json::Value, app: tauri::AppHandle<R>) -> bool {
        let handler = self
            .handlers
            .read()
            .expect("router lock poisoned")
            .get(type_tag)
            .cloned();

        match handler {
            Some(handler) => {
                handler(data, app).await;
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    fn mock_app() -> tauri::AppHandle<tauri::test::MockRuntime> {
        tauri::test::mock_app().handle().clone()
    }

    #[tokio::test]
    async fn dispatch_invokes_registered_handler_with_its_data() {
        let router: Router<tauri::test::MockRuntime> = Router::new();
        let seen: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));

        let seen_clone = seen.clone();
        router.register("presence_update", move |data, _app| {
            let seen_clone = seen_clone.clone();
            async move {
                *seen_clone.lock().unwrap() = Some(data);
            }
        });

        let handled = router
            .dispatch(
                "presence_update",
                serde_json::json!({ "id": "u1", "status": "Online" }),
                mock_app(),
            )
            .await;

        assert!(handled, "registered type tag should be handled");
        assert_eq!(
            *seen.lock().unwrap(),
            Some(serde_json::json!({ "id": "u1", "status": "Online" }))
        );
    }

    #[tokio::test]
    async fn dispatch_routes_by_type_tag_only_to_the_matching_handler() {
        let router = Router::new();
        let a_calls = Arc::new(AtomicUsize::new(0));
        let b_calls = Arc::new(AtomicUsize::new(0));

        let a = a_calls.clone();
        router.register("call_invite", move |_data, _app| {
            let a = a.clone();
            async move {
                a.fetch_add(1, Ordering::SeqCst);
            }
        });

        let b = b_calls.clone();
        router.register("call_declined", move |_data, _app| {
            let b = b.clone();
            async move {
                b.fetch_add(1, Ordering::SeqCst);
            }
        });

        router
            .dispatch("call_invite", serde_json::Value::Null, mock_app())
            .await;

        assert_eq!(a_calls.load(Ordering::SeqCst), 1);
        assert_eq!(b_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn dispatch_reports_unknown_type_tags_without_panicking() {
        let router = Router::new();
        router.register("presence_update", |_data, _app| async {});

        let handled = router
            .dispatch("some_future_chat_message", serde_json::Value::Null, mock_app())
            .await;

        assert!(!handled, "unregistered type tag should not be handled");
    }

    #[tokio::test]
    async fn re_registering_a_type_tag_replaces_the_previous_handler() {
        let router = Router::new();
        let calls = Arc::new(AtomicUsize::new(0));

        router.register("presence_update", |_data, _app| async {});

        let calls_clone = calls.clone();
        router.register("presence_update", move |_data, _app| {
            let calls_clone = calls_clone.clone();
            async move {
                calls_clone.fetch_add(1, Ordering::SeqCst);
            }
        });

        router
            .dispatch("presence_update", serde_json::Value::Null, mock_app())
            .await;

        assert_eq!(calls.load(Ordering::SeqCst), 1, "only the latest handler should run");
    }
}
