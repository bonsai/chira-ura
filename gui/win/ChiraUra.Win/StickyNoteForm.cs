using ChiraUra.Core;
using System.Drawing;

namespace ChiraUra.Win;

public class StickyNoteForm : Form
{
    private const int FooterHeight = 68;

    private readonly NoteRepository _repository;
    private readonly SyncService _syncService;
    private readonly System.Windows.Forms.Timer _autoSaveTimer;

    private Note _currentNote;
    private bool _isDirty;
    private bool _isSaving;

    private readonly TextBox _textBox;
    private readonly PhysicalButton _pinButton;
    private readonly PhysicalButton _newButton;
    private readonly PhysicalButton _copyButton;
    private readonly PhysicalButton _closeButton;
    private readonly StatusToast _toast;
    private readonly ToolTip _balloon;
    private readonly ToolTip _hints;

    private Point _dragOrigin;
    private bool _dragArmed;
    private bool _dragMoved;

    public StickyNoteForm(NoteRepository? repository = null, SyncService? syncService = null)
    {
        _repository = repository ?? new NoteRepository();
        _syncService = syncService ?? new SyncService(_repository);

        // 起動時は「白紙に書ける状態」。前の下書きが空なら再利用、内容があれば新しい白紙を作る。
        var activeNoteId = _repository.GetMeta("activeNoteId");
        Note? loaded = !string.IsNullOrEmpty(activeNoteId) ? _repository.GetNote(activeNoteId) : null;
        if (loaded != null && string.IsNullOrEmpty(loaded.Content))
        {
            _currentNote = loaded;
        }
        else
        {
            _currentNote = Note.Create("");
            _repository.SetMeta("activeNoteId", _currentNote.Id);
            _repository.UpsertNote(_currentNote);
        }

        // 見た目: 枠なし・スマホサイズ・最前面
        SuspendLayout();
        AutoScaleMode = AutoScaleMode.None;
        Text = "chira-ura";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(360, 640);          // デフォルト: スマホサイズ
        MinimumSize = new Size(280, 420);
        BackColor = Color.FromArgb(254, 252, 232); // 付箋の淡黄色
        ForeColor = Color.FromArgb(30, 41, 59);
        TopMost = true;
        KeyPreview = true;

        // アイコン（exe に埋め込んだ chira.ico）
        try
        {
            var exeIcon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (exeIcon != null) this.Icon = exeIcon;
        }
        catch
        {
            // アイコンが取れなくても続行
        }

        // ---- 2 段レイアウト（上: 本文 / 下: フッター）。ヘッダは無し。----
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Margin = new Padding(0),
            Padding = new Padding(0),
            BackColor = Color.FromArgb(254, 252, 232)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));   // body
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, FooterHeight)); // footer

        // 本文（スクロールバーなし・折り返し）
        _textBox = new TextBox
        {
            Multiline = true,
            AcceptsReturn = true,
            MaxLength = int.MaxValue,
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.None,
            BackColor = Color.FromArgb(254, 252, 232),
            ForeColor = Color.FromArgb(30, 41, 59),
            Font = new Font("Segoe UI", 12F, FontStyle.Regular),
            ScrollBars = ScrollBars.None,
            WordWrap = true,
            ImeMode = ImeMode.Hiragana,   // 日本語入力を明示的に有効化（IME ひらがな）
            Margin = new Padding(10, 10, 10, 0),
            Text = _currentNote.Content
        };
        _textBox.TextChanged += TextBox_TextChanged;   // IME 切替後も本文はそのまま入力できる
        layout.Controls.Add(_textBox, 0, 0);

        // ---- フッター: 物理キー 4 つ（✕ / 📌 / ＋ / 📋）。常設ステータスは置かない。----
        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 4,
            RowCount = 1,
            Margin = new Padding(0),
            Padding = new Padding(8, 6, 8, 6),
            BackColor = Color.FromArgb(253, 230, 138)
        };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));

        // ✕ 閉じる
        _closeButton = MakeKey("✕");
        _closeButton.Click += (s, e) =>
        {
            if (ConsumeDragClick()) return;
            Close();
        };
        footer.Controls.Add(_closeButton, 0, 0);

        // 📌 最前面ピン留め（トグル）。既定は最前面。
        _pinButton = MakeKey(TopMost ? "📌" : "📍");
        _pinButton.Active = TopMost;
        _pinButton.Click += (s, e) =>
        {
            if (ConsumeDragClick()) return;
            TogglePin();
        };
        footer.Controls.Add(_pinButton, 1, 0);

        // ＋ 新しいメモ
        _newButton = MakeKey("＋");
        _newButton.Click += (s, e) =>
        {
            if (ConsumeDragClick()) return;
            NewNote();
        };
        footer.Controls.Add(_newButton, 2, 0);

        // 📋 本文をコピー（前置き・タイトルなし）
        _copyButton = MakeKey("📋");
        _copyButton.Click += (s, e) =>
        {
            if (ConsumeDragClick()) return;
            CopyContent();
        };
        footer.Controls.Add(_copyButton, 3, 0);

        layout.Controls.Add(footer, 0, 1);
        Controls.Add(layout);

        // アクション時だけ出るステータス（常設しない）
        _toast = new StatusToast();
        Controls.Add(_toast);
        _toast.BringToFront();
        _toast.Visible = false;
        Resize += (s, e) => PositionToast();

        ResumeLayout(true);

        // キーの説明（ステータスではなくヒント）
        _hints = new ToolTip();
        _hints.SetToolTip(_closeButton, "閉じる");
        _hints.SetToolTip(_pinButton, "最前面に固定 / 解除");
        _hints.SetToolTip(_newButton, "新しいメモ");
        _hints.SetToolTip(_copyButton, "本文をコピー");

        // 保存したら吹き出しでファイル名を知らせる
        _balloon = new ToolTip
        {
            IsBalloon = true,
            ShowAlways = true,
            InitialDelay = 0,
            ReshowDelay = 0,
            AutoPopDelay = 2600
        };

        // 枠線
        Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(202, 138, 4), 1);
            e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        };

        // 自動保存（1 秒デバウンス）
        _autoSaveTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _autoSaveTimer.Tick += async (s, e) =>
        {
            _autoSaveTimer.Stop();
            if (_isDirty) await SaveDraftAsync(closed: false);
        };

        // 枠なしウィンドウの移動: 余白・フッター・キーをつかんで動かせる
        EnableDrag(this);
        EnableDrag(layout);
        EnableDrag(footer);
        EnableDrag(_closeButton);
        EnableDrag(_pinButton);
        EnableDrag(_newButton);
        EnableDrag(_copyButton);
        EnableDrag(_toast);

        // 起動直後から「すぐ書ける」
        Shown += (s, e) => FocusEditor();

        // 終了時: ローカル保存は同期・確実に
        FormClosing += (s, e) =>
        {
            _autoSaveTimer.Stop();
            _currentNote.Content = _textBox.Text;
            _currentNote.Title = Note.DeriveTitle(_currentNote.Content);
            _currentNote.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _repository.UpsertNote(_currentNote);

            try
            {
                Task.Run(async () =>
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
                    await _syncService.SaveAndSyncAsync(_currentNote, closed: true, cts.Token).ConfigureAwait(false);
                }).Wait(TimeSpan.FromMilliseconds(500));
            }
            catch
            {
                // オフライン時はローカルに残る
            }
        };
    }

    private static PhysicalButton MakeKey(string glyph)
    {
        return new PhysicalButton
        {
            Glyph = glyph,
            Dock = DockStyle.Fill,
            Margin = new Padding(4, 2, 4, 2)
        };
    }

    private void PositionToast()
    {
        _toast.Left = Math.Max(8, ClientSize.Width - _toast.Width - 14);
        _toast.Top = Math.Max(8, ClientSize.Height - FooterHeight - _toast.Height - 12);
    }

    private void Flash(string message)
    {
        _toast.Flash(message);
        PositionToast();
    }

    private void TogglePin()
    {
        TopMost = !TopMost;
        _pinButton.Active = TopMost;
        _pinButton.Glyph = TopMost ? "📌" : "📍";
        Flash(TopMost ? "📌  最前面に固定" : "📍  固定を解除");
    }

    private void CopyContent()
    {
        var text = _textBox.Text;
        if (string.IsNullOrEmpty(text))
        {
            Flash("✖️  対象なし");
            return;
        }

        try
        {
            Clipboard.SetText(text);
            Flash("📋  コピーしました");
        }
        catch
        {
            Flash("🚫  コピー失敗");
        }
    }

    /// <summary>
    /// キーを押したまま動かした場合はドラッグとして扱い、クリックを捨てる。
    /// </summary>
    private bool ConsumeDragClick()
    {
        if (!_dragMoved) return false;
        _dragMoved = false;
        return true;
    }

    private void EnableDrag(Control control)
    {
        control.MouseDown += (s, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            _dragArmed = true;
            _dragMoved = false;
            _dragOrigin = Cursor.Position;
        };

        control.MouseMove += (s, e) =>
        {
            if (!_dragArmed) return;

            var now = Cursor.Position;
            if (!_dragMoved)
            {
                if (Math.Abs(now.X - _dragOrigin.X) < 5 && Math.Abs(now.Y - _dragOrigin.Y) < 5) return;
                _dragMoved = true;
            }

            Location = new Point(
                Location.X + (now.X - _dragOrigin.X),
                Location.Y + (now.Y - _dragOrigin.Y));
            _dragOrigin = now;
        };

        control.MouseUp += (s, e) => _dragArmed = false;
    }

    private void FocusEditor()
    {
        Activate();
        _textBox.Focus();
        _textBox.SelectionStart = _textBox.Text.Length;
    }

    private void TextBox_TextChanged(object? sender, EventArgs e)
    {
        _isDirty = true;
        _autoSaveTimer.Stop();
        _autoSaveTimer.Start();
    }

    private async Task SaveDraftAsync(bool closed)
    {
        if (_isSaving) return;
        _isSaving = true;

        try
        {
            _currentNote.Content = _textBox.Text;
            _currentNote.Title = Note.DeriveTitle(_currentNote.Content);
            _currentNote.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            var synced = await _syncService.SaveAndSyncAsync(_currentNote, closed);
            _isDirty = false;

            // 吹き出し: 保存したファイル名を表示（アクション時のみ）
            var fileName = SyncService.FormatNoteFileName(_currentNote.UpdatedAt);
            var message = synced
                ? $"💾 保存しました\n{fileName}"
                : $"💾 ローカル保存\n{fileName}";
            _balloon.Show(message, this, new Point(Width / 2, Height - FooterHeight - 12), 2600);
        }
        finally
        {
            _isSaving = false;
        }
    }

    private async void NewNote()
    {
        if (_isDirty)
        {
            await SaveDraftAsync(closed: true);
        }

        _currentNote = Note.Create("");
        _repository.SetMeta("activeNoteId", _currentNote.Id);
        _repository.UpsertNote(_currentNote);

        _textBox.Text = "";
        _isDirty = false;
        Flash("＋  新しいメモ");
        FocusEditor();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _autoSaveTimer.Dispose();
            _balloon.Dispose();
            _hints.Dispose();
            _repository.Dispose();
        }
        base.Dispose(disposing);
    }
}
