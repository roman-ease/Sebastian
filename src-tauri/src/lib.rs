use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("sebastian.db").to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;
    let dest_path = Path::new(&dest);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, dest_path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn get_file_mtime(path: String) -> Option<u64> {
    use std::time::UNIX_EPOCH;
    std::fs::metadata(&path).ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

#[tauri::command]
fn launch_local_ai(server: String) -> Result<String, String> {
    use std::process::Command;

    match server.as_str() {
        "ollama" => {
            if cfg!(target_os = "macos") {
                Command::new("open")
                    .args(["-a", "Ollama"])
                    .spawn()
                    .map_err(|e| format!("Ollama.app が見つかりません。Ollama をインストールしてください: {e}"))?;
                Ok("Ollama を起動しました".to_string())
            } else {
                Command::new("ollama")
                    .arg("serve")
                    .spawn()
                    .map_err(|e| format!("ollama コマンドが見つかりません。Ollama をインストールしてください: {e}"))?;
                Ok("Ollama サーバーを起動しました".to_string())
            }
        }
        "lmstudio" => {
            if cfg!(target_os = "macos") {
                let home = std::env::var("HOME").unwrap_or_default();
                let lms_cli = format!("{home}/.lmstudio/bin/lms");
                if std::path::Path::new(&lms_cli).exists() {
                    Command::new(&lms_cli)
                        .args(["server", "start"])
                        .spawn()
                        .map_err(|e| format!("LM Studio サーバーの起動に失敗しました: {e}"))?;
                    Ok("LM Studio サーバーを起動しました".to_string())
                } else {
                    Command::new("open")
                        .args(["-a", "LM Studio"])
                        .spawn()
                        .map_err(|e| format!("LM Studio が見つかりません。LM Studio をインストールしてください: {e}"))?;
                    Ok("LM Studio を開きました。アプリ内の「Local Server」タブでサーバーを開始してください。".to_string())
                }
            } else {
                Err("LM Studio の自動起動は macOS のみ対応しています".to_string())
            }
        }
        _ => Err(format!("不明なサーバー種別: {server}"))
    }
}

// ── OS キーチェーンによる機密値ストア ─────────────────────────────────────────
// API キー・Supabase 匿名キーを平文 SQLite ではなく OS の資格情報ストアへ置く。
const KEYRING_SERVICE: &str = "com.roman-ease.sebastian";

#[tauri::command]
fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    if value.is_empty() {
        // 空文字はクリア。存在しなくてもエラーにしない。
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_secret(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: "
            CREATE TABLE IF NOT EXISTS daily_memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                priority TEXT DEFAULT 'none',
                due_date TEXT,
                category TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS task_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                action_type TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                actor_type TEXT NOT NULL,
                source_type TEXT,
                source_id TEXT,
                suggestion_group_id TEXT,
                applied_by TEXT,
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS reports_daily (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS reports_weekly (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start_date TEXT NOT NULL UNIQUE,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_archived_to_tasks",
            sql: "ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_pinned_to_tasks",
            sql: "ALTER TABLE tasks ADD COLUMN pinned INTEGER DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_notes_to_tasks",
            sql: "ALTER TABLE tasks ADD COLUMN notes TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_start_date_to_tasks",
            sql: "ALTER TABLE tasks ADD COLUMN start_date TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_progress_to_tasks",
            sql: "ALTER TABLE tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_task_checklist",
            sql: "
            CREATE TABLE IF NOT EXISTS task_checklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_custom_providers",
            sql: "
            CREATE TABLE IF NOT EXISTS custom_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'openai',
                endpoint TEXT NOT NULL,
                api_key TEXT,
                model TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_sync_id_columns",
            sql: "
            ALTER TABLE tasks ADD COLUMN sync_id TEXT;
            ALTER TABLE task_checklist ADD COLUMN sync_id TEXT;
            ALTER TABLE daily_memos ADD COLUMN sync_id TEXT;
            ALTER TABLE reports_daily ADD COLUMN sync_id TEXT;
            ALTER TABLE reports_weekly ADD COLUMN sync_id TEXT;
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:sebastian.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, write_text_file, read_text_file,
            get_db_path, copy_file, file_exists, get_file_mtime,
            launch_local_ai,
            set_secret, get_secret, delete_secret
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::menu::{Menu, MenuItem};

    let show_item = MenuItem::with_id(app, "show", "Sebastianを開く", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Sebastian - AI Work Supporter")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
