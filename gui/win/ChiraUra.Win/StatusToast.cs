using System.Drawing;
using System.Drawing.Drawing2D;

namespace ChiraUra.Win;

/// <summary>
/// アクションがあったときだけ一瞬出るステータス（トースト）。
/// 常設しない。表示 → 保持 → フェードアウトで消える。
/// </summary>
public sealed class StatusToast : Control
{
    private readonly System.Windows.Forms.Timer _timer;
    private string _message = "";
    private int _alpha;
    private long _holdUntil;
    private bool _fading;

    public StatusToast()
    {
        SetStyle(
            ControlStyles.UserPaint
            | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.ResizeRedraw
            | ControlStyles.SupportsTransparentBackColor,
            true);

        BackColor = Color.Transparent;
        Visible = false;
        Font = new Font("Segoe UI Emoji", 10F, FontStyle.Regular, GraphicsUnit.Point);

        _timer = new System.Windows.Forms.Timer { Interval = 30 };
        _timer.Tick += (s, e) => Tick();
    }

    public void Flash(string message, int holdMs = 1500)
    {
        _message = message;

        var measured = TextRenderer.MeasureText(message, Font);
        Width = measured.Width + 28;
        Height = 38;

        _alpha = 255;
        _fading = false;
        _holdUntil = Environment.TickCount64 + holdMs;
        Visible = true;
        BringToFront();
        _timer.Start();
        Invalidate();
    }

    private void Tick()
    {
        if (!_fading && Environment.TickCount64 >= _holdUntil)
        {
            _fading = true;
        }

        if (!_fading) return;

        _alpha -= 28;
        if (_alpha <= 0)
        {
            _alpha = 0;
            _timer.Stop();
            Visible = false;
            return;
        }

        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;

        var parentBack = Parent?.BackColor ?? Color.FromArgb(254, 252, 232);
        g.Clear(parentBack);

        var rect = new Rectangle(0, 0, Width - 1, Height - 1);
        using var pill = PhysicalButton.RoundedRect(rect, Height / 2);
        using (var fill = new SolidBrush(Color.FromArgb(_alpha, 44, 36, 30)))
        {
            g.FillPath(fill, pill);
        }

        using var textBrush = new SolidBrush(Color.FromArgb(_alpha, 255, 252, 240));
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            FormatFlags = StringFormatFlags.NoWrap
        };
        g.DrawString(_message, Font, textBrush, new RectangleF(0, 0, Width, Height), format);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}
