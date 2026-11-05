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

        // Status Label (shows subtle icon or status)
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
            Location = new Point(40, 4),
            Cursor = Cursors.Hand
        };
        _newButton.FlatAppearance.BorderSize = 0;
        _newButton.Click += (s, e) => NewNote();
        _titleBar.Controls.Add(_newButton);

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

        // Immediate focus on text area
        Shown += (s, e) =>
        {
            _textBox.Focus();
            _textBox.SelectionStart = _textBox.Text.Length;
        };

        // Form Closing - sync with closed=true
        FormClosing += (s, e) =>
        {
            _autoSaveTimer.Stop();
            // Perform synchronous/fast final flush on close
            _currentNote.Content = _textBox.Text;
            _currentNote.Title = Note.DeriveTitle(_currentNote.Content);
            _currentNote.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            // Local save is synchronous and guaranteed
            _repository.UpsertNote(_currentNote);

            // Trigger non-blocking cloud send or fast send
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(500));
                _syncService.SaveAndSyncAsync(_currentNote, closed: true, cts.Token).GetAwaiter().GetResult();
            }
            catch
            {
                // Fallback to local outbox
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
