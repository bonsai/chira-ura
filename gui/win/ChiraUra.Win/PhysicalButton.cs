using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace ChiraUra.Win;

/// <summary>
/// フッターに載る「物理キー」風ボタン。
/// ベベル・グラデーション・押下で沈む表現を自前描画する。
/// </summary>
public sealed class PhysicalButton : Control
{
    private bool _hover;
    private bool _pressed;
    private bool _active;
    private string _glyph = "";

    public PhysicalButton()
    {
        SetStyle(
            ControlStyles.UserPaint
            | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer
            | ControlStyles.ResizeRedraw
            | ControlStyles.SupportsTransparentBackColor,
            true);

        BackColor = Color.Transparent;
        Cursor = Cursors.Hand;
        TabStop = false;
        Font = new Font("Segoe UI", 18F, FontStyle.Regular, GraphicsUnit.Point);
        Size = new Size(72, 48);
    }

    /// <summary>キーに描く絵文字・記号（✕ / 📌 / ＋ / 📋 など）。</summary>
    [DefaultValue("")]
    public string Glyph
    {
        get => _glyph;
        set
        {
            if (_glyph == value) return;
            _glyph = value;
            Invalidate();
        }
    }

    /// <summary>トグル中のキー（最前面ピンなど）をアクセント表示にする。</summary>
    [DefaultValue(false)]
    public bool Active
    {
        get => _active;
        set
        {
            if (_active == value) return;
            _active = value;
            Invalidate();
        }
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _pressed = true;
            Capture = true;
            Invalidate();
        }
        base.OnMouseDown(e);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (_pressed)
        {
            _pressed = false;
            Capture = false;
            Invalidate();
        }
        base.OnMouseUp(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var parentBack = Parent?.BackColor ?? Color.FromArgb(253, 230, 138);
        g.Clear(parentBack);

        // キーの外形（下に 2px の影を残す）
        var key = new Rectangle(2, 2, Width - 5, Height - 6);
        if (_pressed) key.Offset(0, 1);

        const int radius = 7;

        // 物理的な厚み（キーの下の影）
        if (!_pressed)
        {
            using var shadowPath = RoundedRect(new Rectangle(key.X, key.Y + 2, key.Width, key.Height), radius);
            using var shadow = new SolidBrush(Color.FromArgb(55, 120, 84, 20));
            g.FillPath(shadow, shadowPath);
        }

        var top = _active ? Color.FromArgb(255, 246, 210) : Color.FromArgb(255, 253, 245);
        var bottom = _active ? Color.FromArgb(242, 205, 112) : Color.FromArgb(238, 225, 185);

        if (_pressed)
        {
            top = Color.FromArgb(232, 214, 168);
            bottom = Color.FromArgb(244, 232, 199);
        }
        else if (_hover)
        {
            top = Lighten(top, 8);
            bottom = Lighten(bottom, 10);
        }

        using var bodyPath = RoundedRect(key, radius);
        using (var body = new LinearGradientBrush(key, top, bottom, LinearGradientMode.Vertical))
        {
            g.FillPath(body, bodyPath);
        }

        // 縁（押下中は内側に沈める）
        var borderColor = _active ? Color.FromArgb(139, 0, 0) : Color.FromArgb(188, 150, 48);
        using (var border = new Pen(borderColor, _active ? 1.7F : 1.1F))
        {
            g.DrawPath(border, bodyPath);
        }

        // 上辺のハイライト / 下辺の陰
        var inset = radius / 2 + 1;
        using (var highlight = new Pen(Color.FromArgb(_pressed ? 50 : 190, 255, 255, 255), 1F))
        {
            g.DrawLine(highlight, key.X + inset, key.Y + 1, key.Right - inset, key.Y + 1);
        }
        using (var shade = new Pen(Color.FromArgb(_pressed ? 90 : 45, 120, 90, 30), 1F))
        {
            g.DrawLine(shade, key.X + inset, key.Bottom - 1, key.Right - inset, key.Bottom - 1);
        }

        // 記号（GDI 描画で絵文字の色を保つ）
        var glyphColor = _active ? Color.FromArgb(139, 0, 0) : Color.FromArgb(74, 58, 28);
        var glyphRect = key;
        if (_pressed) glyphRect.Offset(0, 1);
        TextRenderer.DrawText(
            g,
            _glyph,
            Font,
            glyphRect,
            glyphColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

        if (Focused)
        {
            using var focus = new Pen(Color.FromArgb(120, 44, 36, 30), 1F) { DashStyle = DashStyle.Dot };
            g.DrawPath(focus, bodyPath);
        }
    }

    private static Color Lighten(Color color, int amount)
    {
        return Color.FromArgb(
            color.A,
            Math.Min(255, color.R + amount),
            Math.Min(255, color.G + amount),
            Math.Min(255, color.B + amount));
    }

    internal static GraphicsPath RoundedRect(Rectangle rect, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        if (d <= 0)
        {
            path.AddRectangle(rect);
            return path;
        }

        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
