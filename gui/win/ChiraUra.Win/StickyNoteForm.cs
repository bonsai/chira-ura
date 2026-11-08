using ChiraUra.Core;
using System.Drawing;

namespace ChiraUra.Win;

public class StickyNoteForm : Form
{
    private readonly NoteRepository _repository;
    private readonly SyncService _syncService;
    private readonly System.Windows.Forms.Timer _autoSaveTimer;

    private Note _currentNote;
    private bool _isDirty;
    private bool _isSaving;

    private readonly TextBox _textBox;
    private readonly Label _statusLabel;
    private readonly Button _pinButton;
    private readonly Button _newButton;
    private readonly Button _closeButton;
    private readonly ToolTip _balloon;

    private Point _dragStartPoint;
    private bool _isDragging;

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
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 64F));    // footer（高め）

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

        // フッター: 四等分（📝 ステータス / 📌 最前面ピン / ＋ / ✕）
        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 4,
            RowCount = 1,
            Margin = new Padding(0),
            Padding = new Padding(0),
            BackColor = Color.FromArgb(254, 240, 138)
        };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25F));
        footer.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));

        // 左: 絵文字ステータス（ドラッグでも動かせる）
        _statusLabel = new Label
        {
            Text = "📝",
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI Emoji", 20F),
            BackColor = Color.Transparent,
            Margin = new Padding(0),
            Cursor = Cursors.SizeAll
        };
        _statusLabel.MouseDown += DragStart;
        _statusLabel.MouseMove += DragMove;
        _statusLabel.MouseUp += DragEnd;
        footer.Controls.Add(_statusLabel, 0, 0);

        // 📌 最前面ピン留め（トグル）。既定は最前面（TopMost = true）。
        _pinButton = MakeFooterButton(TopMost ? "📌" : "📍");
        _pinButton.Click += (s, e) =>
        {
            TopMost = !TopMost;
            _pinButton.Text = TopMost ? "📌" : "📍";
        };
        footer.Controls.Add(_pinButton, 1, 0);

        // ＋（横長・大きめ）
        _newButton = MakeFooterButton("＋");
        _newButton.Click += (s, e) => NewNote();
        footer.Controls.Add(_newButton, 2, 0);

        // ✕（横長・大きめ）
        _closeButton = MakeFooterButton("✕");
        _closeButton.Click += (s, e) => Close();
        footer.Controls.Add(_closeButton, 3, 0);

        layout.Controls.Add(footer, 0, 1);

        Controls.Add(layout);
        ResumeLayout(true);

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

    private static Button MakeFooterButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Dock = DockStyle.Fill,
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(1, 4, 1, 4),
            Cursor = Cursors.Hand,
            Font = new Font("Segoe UI", 18F),
            TabStop = false
        };
        button.FlatAppearance.BorderSize = 0;
        return button;
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
        _statusLabel.Text = "✏️";
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
            _statusLabel.Text = synced ? "💾" : "📝";

            // 吹き出し: 保存したファイル名を表示
            var fileName = SyncService.FormatNoteFileName(_currentNote.UpdatedAt);
            var message = synced
                ? $"💾 保存しました\n{fileName}"
                : $"💾 ローカル保存\n{fileName}";
            _balloon.Show(message, _statusLabel, new Point(_statusLabel.Width / 2, 0), 2600);
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
        _statusLabel.Text = "📝";
        FocusEditor();
    }

    private void DragStart(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _isDragging = true;
            _dragStartPoint = e.Location;
        }
    }

    private void DragMove(object? sender, MouseEventArgs e)
    {
        if (_isDragging)
        {
            Location = new Point(Location.X + (e.X - _dragStartPoint.X), Location.Y + (e.Y - _dragStartPoint.Y));
        }
    }

    private void DragEnd(object? sender, MouseEventArgs e)
    {
        _isDragging = false;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _autoSaveTimer.Dispose();
            _repository.Dispose();
        }
        base.Dispose(disposing);
    }
}
