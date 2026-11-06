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
    private readonly Button _syncButton;
    private readonly Button _closeButton;
    private readonly Panel _titleBar;

    private Point _dragStartPoint;
    private bool _isDragging;

    public StickyNoteForm(NoteRepository? repository = null, SyncService? syncService = null)
    {
        _repository = repository ?? new NoteRepository();
        _syncService = syncService ?? new SyncService(_repository);

        // Load active draft or create a new note
        var activeNoteId = _repository.GetMeta("activeNoteId");
        Note? loaded = null;
        if (!string.IsNullOrEmpty(activeNoteId))
        {
            loaded = _repository.GetNote(activeNoteId);
        }

        _currentNote = loaded ?? Note.Create("");
        _repository.SetMeta("activeNoteId", _currentNote.Id);

        // Form setup (sticky note style)
        Text = "chira-ura";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(320, 360);
        MinimumSize = new Size(200, 200);
        BackColor = Color.FromArgb(254, 252, 232); // Light yellow note color (#FEFCE8)
        TopMost = true;

        // Custom Title/Header Bar
        _titleBar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 32,
            BackColor = Color.FromArgb(254, 240, 138), // Slightly darker yellow (#FEF08A)
            Padding = new Padding(8, 0, 8, 0)
        };
        _titleBar.MouseDown += TitleBar_MouseDown;
        _titleBar.MouseMove += TitleBar_MouseMove;
        _titleBar.MouseUp += TitleBar_MouseUp;

        // Status Label (shows subtle icon or status: 📝 local, 💾 synced, ✏️ editing)
        _statusLabel = new Label
        {
            Text = "📝",
            AutoSize = true,
            Location = new Point(8, 7),
            Font = new Font("Segoe UI Emoji", 10F),
            Cursor = Cursors.Hand
        };
        _titleBar.Controls.Add(_statusLabel);

        // New Note Button (+)
        _newButton = new Button
        {
            Text = "＋",
            FlatStyle = FlatStyle.Flat,
            Size = new Size(24, 24),
            Location = new Point(36, 4),
            Cursor = Cursors.Hand
        };
        _newButton.FlatAppearance.BorderSize = 0;
        _newButton.Click += (s, e) => NewNote();
        _titleBar.Controls.Add(_newButton);

        // Sync Button (🔄 manual / online flush trigger)
        _syncButton = new Button
        {
            Text = "🔄",
            FlatStyle = FlatStyle.Flat,
            Size = new Size(26, 24),
            Location = new Point(64, 4),
            Cursor = Cursors.Hand
        };
        _syncButton.FlatAppearance.BorderSize = 0;
        _syncButton.Click += async (s, e) =>
        {
            _statusLabel.Text = "⏳";
            var result = await _syncService.FlushAllAsync().ConfigureAwait(true);
            _statusLabel.Text = result.LastError == null ? "💾" : "📝";
        };
        _titleBar.Controls.Add(_syncButton);

        // Pin Button (📌)
        _pinButton = new Button
        {
            Text = "📌",
            FlatStyle = FlatStyle.Flat,
            Size = new Size(26, 24),
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
            Location = new Point(Width - 62, 4),
            Cursor = Cursors.Hand
        };
        _pinButton.FlatAppearance.BorderSize = 0;
        _pinButton.Click += (s, e) =>
        {
            TopMost = !TopMost;
            _pinButton.Text = TopMost ? "📌" : "📍";
        };
        _titleBar.Controls.Add(_pinButton);

        // Close Button (✕)
        _closeButton = new Button
        {
            Text = "✕",
            FlatStyle = FlatStyle.Flat,
            Size = new Size(24, 24),
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
            Location = new Point(Width - 32, 4),
            Cursor = Cursors.Hand
        };
        _closeButton.FlatAppearance.BorderSize = 0;
        _closeButton.Click += (s, e) => Close();
        _titleBar.Controls.Add(_closeButton);

        Controls.Add(_titleBar);

        // Text Area (full editor)
        _textBox = new TextBox
        {
            Multiline = true,
            AcceptsReturn = true,
            MaxLength = int.MaxValue,
            Dock = DockStyle.Fill,
            BorderStyle = BorderStyle.None,
            BackColor = Color.FromArgb(254, 252, 232),
            ForeColor = Color.FromArgb(30, 41, 59),
            Font = new Font("Segoe UI", 11F, FontStyle.Regular),
            ScrollBars = ScrollBars.Vertical,
            Text = _currentNote.Content
        };
        _textBox.TextChanged += TextBox_TextChanged;
        Controls.Add(_textBox);

        // Resize grip support or border line
        Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(202, 138, 4), 1);
            e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        };

        // Auto-save debounce timer (every 1 second when dirty)
        _autoSaveTimer = new System.Windows.Forms.Timer
        {
            Interval = 1000
        };
        _autoSaveTimer.Tick += async (s, e) =>
        {
            _autoSaveTimer.Stop();
            if (_isDirty)
            {
                await SaveDraftAsync(closed: false);
            }
        };

        // Immediate focus on text area and online flush check in background
        Shown += (s, e) =>
        {
            _textBox.Focus();
            _textBox.SelectionStart = _textBox.Text.Length;

            // Background initial flush check on startup/reconnect
            _ = Task.Run(async () =>
            {
                try
                {
                    await _syncService.FlushAllAsync().ConfigureAwait(false);
                }
                catch { }
            });
        };

        // Form Closing - flush fractions (<10) on exit
        FormClosing += (s, e) =>
        {
            _autoSaveTimer.Stop();

            _currentNote.Content = _textBox.Text;
            _currentNote.Title = Note.DeriveTitle(_currentNote.Content);
            _currentNote.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            // 1. Local save is synchronous and guaranteed (offline accumulation)
            _repository.UpsertNote(_currentNote);

            if (!string.IsNullOrWhiteSpace(_currentNote.Content))
            {
                var fileName = SyncService.FormatNoteFileName(_currentNote.UpdatedAt);
                _repository.EnqueueWikiMemo(_currentNote.Id, fileName, _currentNote.Content, _currentNote.UpdatedAt);
            }

            // 2. Trigger quick push on closing (fractions flushed)
            try
            {
                Task.Run(async () =>
                {
                    using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(1000));
                    await _syncService.FlushAllAsync(cts.Token).ConfigureAwait(false);
                }).Wait(TimeSpan.FromMilliseconds(1000));
            }
            catch
            {
                // Fallback: items remain safely in local SQLite wiki_queue
            }
        };
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

            // Local save + 10-batch push check
            var synced = await _syncService.SaveAndSyncAsync(_currentNote, closed);
            _isDirty = false;
            _statusLabel.Text = synced ? "💾" : "📝";
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
        _textBox.Focus();
        _isDirty = false;
        _statusLabel.Text = "📝";
    }

    private void TitleBar_MouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _isDragging = true;
            _dragStartPoint = e.Location;
        }
    }

    private void TitleBar_MouseMove(object? sender, MouseEventArgs e)
    {
        if (_isDragging)
        {
            var diffX = e.X - _dragStartPoint.X;
            var diffY = e.Y - _dragStartPoint.Y;
            Location = new Point(Location.X + diffX, Location.Y + diffY);
        }
    }

    private void TitleBar_MouseUp(object? sender, MouseEventArgs e)
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
