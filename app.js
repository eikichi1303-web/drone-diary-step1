(() => {
  "use strict";

  const DB_NAME = "DroneDiaryStep1DB";
  const DB_VERSION = 1;
  const STORE_NAME = "memos";
  const BACKUP_FORMAT = "drone-diary-step1-backup";

  let db = null;

  const $ = (id) => document.getElementById(id);
  const statusBox = $("globalStatus");

  function showStatus(message, isError = false) {
    statusBox.textContent = message;
    statusBox.className = isError ? "status error" : "status";
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.classList.remove("active");
    });
    $(name + "Screen").classList.add("active");
    if (name === "list") refreshMemoList();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("このブラウザはIndexedDBに対応していません。"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => reject(request.error || new Error("データベースを開けませんでした。"));
      request.onblocked = () => reject(new Error("別の画面がデータベースを使用中です。画面を閉じて再度お試しください。"));
    });
  }

  function getAllMemos() {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
          resolve(request.result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
        };
        request.onerror = () => reject(request.error || new Error("メモを読み込めませんでした。"));
        tx.onerror = () => reject(tx.error || new Error("データの読み込みに失敗しました。"));
      } catch (error) {
        reject(error);
      }
    });
  }

  function addMemo(memo) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).add(memo);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("保存に失敗しました。"));
        tx.onabort = () => reject(tx.error || new Error("保存が中止されました。"));
      } catch (error) {
        reject(error);
      }
    });
  }

  function deleteMemo(id) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("削除に失敗しました。"));
        tx.onabort = () => reject(tx.error || new Error("削除が中止されました。"));
      } catch (error) {
        reject(error);
      }
    });
  }

  function importMemos(memos) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        let added = 0;
        let skipped = 0;

        memos.forEach((memo) => {
          const request = store.get(memo.id);
          request.onsuccess = () => {
            if (request.result) {
              skipped += 1;
            } else {
              store.add(memo);
              added += 1;
            }
          };
          request.onerror = () => tx.abort();
        });

        tx.oncomplete = () => resolve({ added, skipped });
        tx.onerror = () => reject(tx.error || new Error("バックアップの読み込みに失敗しました。"));
        tx.onabort = () => reject(tx.error || new Error("読み込み処理が中止されました。"));
      } catch (error) {
        reject(error);
      }
    });
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "日時不明";
    return date.toLocaleString("ja-JP");
  }

  async function refreshMemoList() {
    const list = $("memoList");
    list.replaceChildren();

    try {
      const memos = await getAllMemos();
      if (memos.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "保存されたメモはありません。";
        list.appendChild(empty);
        return;
      }

      memos.forEach((memo) => {
        const card = document.createElement("article");
        card.className = "memo-card";

        const date = document.createElement("div");
        date.className = "memo-date";
        date.textContent = "保存日時：" + formatDate(memo.createdAt);

        const text = document.createElement("div");
        text.className = "memo-text";
        text.textContent = memo.text;

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-button";
        deleteButton.textContent = "このメモを削除";
        deleteButton.addEventListener("click", async () => {
          const ok = window.confirm("このメモを削除します。よろしいですか？");
          if (!ok) return;
          try {
            await deleteMemo(memo.id);
            showStatus("メモを削除しました。");
            await refreshMemoList();
          } catch (error) {
            showStatus("削除できませんでした：" + error.message, true);
          }
        });

        card.append(date, text, deleteButton);
        list.appendChild(card);
      });
    } catch (error) {
      showStatus("一覧を表示できません：" + error.message, true);
    }
  }

  async function saveCurrentMemo() {
    const text = $("memoInput").value.trim();
    if (!text) {
      showStatus("メモの内容を入力してください。", true);
      return;
    }

    const memo = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        "memo-" + Date.now() + "-" + Math.random().toString(16).slice(2),
      text,
      createdAt: new Date().toISOString()
    };

    try {
      await addMemo(memo);
      $("memoInput").value = "";
      showStatus("メモを端末内に保存しました。");
      showScreen("home");
    } catch (error) {
      showStatus("保存できませんでした：" + error.message, true);
      window.alert("保存できませんでした。\n端末の空き容量やブラウザの設定を確認してください。\n\n" + error.message);
    }
  }

  async function exportBackup() {
    try {
      const memos = await getAllMemos();
      const backup = {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        memos
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "drone-diary-backup-" +
        new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showStatus("バックアップファイルを作成しました。");
    } catch (error) {
      showStatus("書き出しできませんでした：" + error.message, true);
    }
  }

  function validateBackup(data) {
    if (!data || data.format !== BACKUP_FORMAT || data.version !== 1 ||
        !Array.isArray(data.memos)) {
      throw new Error("このアプリのバックアップ形式ではありません。");
    }

    return data.memos.map((memo) => {
      if (!memo || typeof memo.id !== "string" || !memo.id ||
          typeof memo.text !== "string" ||
          typeof memo.createdAt !== "string" ||
          Number.isNaN(new Date(memo.createdAt).getTime())) {
        throw new Error("バックアップ内に形式が正しくないメモがあります。");
      }
      return {
        id: memo.id,
        text: memo.text,
        createdAt: memo.createdAt
      };
    });
  }

  async function importBackup() {
    const fileInput = $("backupFile");
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
      showStatus("先にJSONファイルを選択してください。", true);
      return;
    }

    try {
      const content = await file.text();
      const data = JSON.parse(content);
      const memos = validateBackup(data);

      const ok = window.confirm(
        "バックアップ内のメモは " + memos.length + " 件です。\n\n" +
        "既存のメモは削除・上書きしません。\n" +
        "同じIDのメモは読み込まず、新しいメモだけを追加します。\n\n" +
        "読み込みを実行しますか？"
      );
      if (!ok) return;

      const result = await importMemos(memos);
      fileInput.value = "";
      showStatus(
        "読み込み完了：追加 " + result.added + " 件、重複のためスキップ " +
        result.skipped + " 件。既存データは保持されています。"
      );
    } catch (error) {
      showStatus("読み込めませんでした：" + error.message, true);
      window.alert("バックアップを読み込めませんでした。\n" + error.message);
    }
  }

  $("goWrite").addEventListener("click", () => showScreen("write"));
  $("goList").addEventListener("click", () => showScreen("list"));
  $("goBackup").addEventListener("click", () => showScreen("backup"));
  $("saveMemo").addEventListener("click", saveCurrentMemo);
  $("exportBackup").addEventListener("click", exportBackup);
  $("importBackup").addEventListener("click", importBackup);

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showScreen("home"));
  });

  async function startApp() {
    try {
      await openDatabase();
      showStatus("準備完了。メモはこの端末内に保存されます。");
    } catch (error) {
      showStatus("端末内の保存機能を開始できません：" + error.message, true);
      window.alert("保存機能を開始できません。\nこのブラウザで利用できるか確認してください。\n\n" + error.message);
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch (error) {
        showStatus("オフライン機能の準備に失敗しました：" + error.message, true);
      }
    }
  }

  startApp();
})();