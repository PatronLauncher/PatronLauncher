pub mod app;
pub mod lock;
pub mod security;
pub mod types;
use std::{sync::mpsc, time::Duration};
use types::{Action, EventEnvelope, Notification, Reply};

struct Request {
    action: Action,
    reply: tokio::sync::oneshot::Sender<Result<Reply, String>>,
}
// A single actor serializes state changes. Existing download/auth/game workers
// communicate with it using their original mpsc Events.
pub struct CoreService {
    tx: mpsc::SyncSender<Request>,
}
impl CoreService {
    pub fn start(root: std::path::PathBuf, emit: impl Fn(Notification) + Send + 'static) -> Self {
        let (tx, rx) = mpsc::sync_channel::<Request>(32);
        std::thread::spawn(move || {
            let mut app = app::App::open(root);
            let mut sequence = 0u64;
            loop {
                match rx.recv_timeout(Duration::from_millis(30)) {
                    Ok(request) => {
                        let result = app.dispatch(request.action);
                        let _ = request.reply.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        app.cancel_on_shutdown();
                        break;
                    }
                }
                app.update(app::Message::Tick);
                if !app.notifications.is_empty() {
                    for event in app.notifications.drain(..) {
                        sequence += 1;
                        emit(Notification::Event(EventEnvelope::new(sequence, event)));
                    }
                    emit(Notification::State(app.snapshot()));
                }
            }
        });
        Self { tx }
    }
    pub async fn call(&self, action: Action) -> Result<Reply, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx
            .try_send(Request { action, reply: tx })
            .map_err(|e| {
                match e {
                    mpsc::TrySendError::Full(_) => "Komut kuyruğu dolu.",
                    mpsc::TrySendError::Disconnected(_) => "Çekirdek kapalı.",
                }
                .to_string()
            })?;
        rx.await
            .map_err(|_| "Çekirdek yanıt vermeden kapandı.".to_string())?
    }
}
