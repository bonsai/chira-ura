use crate::editor::{Editor, Mode};
use crate::files::FileManager;
use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
};

pub fn render(frame: &mut Frame, editor: &mut Editor, file_mgr: &FileManager) {
    let size = frame.area();

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(size);

    let main_area = chunks[0];
    let status_area = chunks[1];
    let cmd_area = chunks[2];

    let sidebar_width = if main_area.width > 80 {
        26
    } else {
        (main_area.width / 4).clamp(16, 26)
    };
    let h_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(sidebar_width), Constraint::Min(20)])
        .split(main_area);

    let sidebar_area = h_chunks[0];
    let editor_area = h_chunks[1];

    let items: Vec<ListItem> = file_mgr
        .items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let is_selected = i == file_mgr.selected_idx;
            let is_open = editor
                .file_path
                .as_ref()
                .map(|p| p == &item.path)
                .unwrap_or(false);

            let prefix = if is_selected {
                "> "
            } else if is_open {
                "* "
            } else {
                "  "
            };

            let mut style = Style::default();
            if is_selected {
                style = style.fg(Color::Yellow).add_modifier(Modifier::BOLD);
            } else if is_open {
                style = style.fg(Color::Cyan);
            } else {
                style = style.fg(Color::Gray);
            }

            ListItem::new(Line::from(vec![
                Span::styled(prefix, style),
                Span::styled(item.name.clone(), style),
            ]))
        })
        .collect();

    let sidebar_block = Block::default()
        .borders(Borders::RIGHT)
        .title(" Files ")
        .border_style(Style::default().fg(Color::DarkGray));
    let sidebar_list = List::new(items).block(sidebar_block);
    frame.render_widget(sidebar_list, sidebar_area);

    let editor_inner_width = editor_area.width as usize;
    let editor_inner_height = editor_area.height as usize;

    if editor.cursor_row < editor.scroll_row {
        editor.scroll_row = editor.cursor_row;
    } else if editor.cursor_row >= editor.scroll_row + editor_inner_height {
        editor.scroll_row = editor.cursor_row - editor_inner_height + 1;
    }

    if editor.cursor_col < editor.scroll_col {
        editor.scroll_col = editor.cursor_col;
    } else if editor.cursor_col >= editor.scroll_col + editor_inner_width {
        editor.scroll_col = editor.cursor_col - editor_inner_width + 1;
    }

    let mut editor_lines: Vec<Line> = Vec::new();
    let start_row = editor.scroll_row;
    let end_row = (start_row + editor_inner_height).min(editor.lines.len());

    for r in start_row..end_row {
        let is_cur_row = r == editor.cursor_row;
        let is_fm = editor.is_frontmatter_line(r);
        let line_str = &editor.lines[r];

        let chars: Vec<char> = line_str.chars().collect();
        let display_chars = if editor.scroll_col < chars.len() {
            &chars[editor.scroll_col..]
        } else {
            &[]
        };

        let mut base_style = Style::default();
        if is_fm {
            base_style = base_style.fg(Color::DarkGray);
        } else {
            base_style = base_style.fg(Color::White);
        }

        if is_cur_row {
            base_style = base_style.bg(Color::Rgb(40, 40, 40));
        }

        let mut spans = Vec::new();
        let query = &editor.search_query;
        let full_line: String = display_chars.iter().collect();

        if !query.is_empty() {
            let mut last_idx = 0;
            while let Some(pos) = full_line[last_idx..].find(query) {
                let match_start = last_idx + pos;
                let match_end = match_start + query.len();

                if match_start > last_idx {
                    spans.push(Span::styled(
                        full_line[last_idx..match_start].to_string(),
                        base_style,
                    ));
                }
                spans.push(Span::styled(
                    full_line[match_start..match_end].to_string(),
                    base_style
                        .bg(Color::Yellow)
                        .fg(Color::Black)
                        .add_modifier(Modifier::BOLD),
                ));
                last_idx = match_end;
            }
            if last_idx < full_line.len() {
                spans.push(Span::styled(full_line[last_idx..].to_string(), base_style));
            }
        } else {
            spans.push(Span::styled(full_line, base_style));
        }

        editor_lines.push(Line::from(spans));
    }

    let editor_block = Block::default();
    let editor_widget = Paragraph::new(editor_lines).block(editor_block);
    frame.render_widget(editor_widget, editor_area);

    let mode_str = match editor.mode {
        Mode::Normal => "NORMAL",
        Mode::Insert => "INSERT",
        Mode::Command => "COMMAND",
        Mode::Search => "SEARCH",
    };

    let fname = editor
        .file_path
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "[No Name]".to_string());

    let mod_indicator = if editor.modified { " [+]" } else { "" };
    let pos_indicator = format!(
        "{}:{} ({} lines)",
        editor.cursor_row + 1,
        editor.cursor_col + 1,
        editor.lines.len()
    );

    let status_style = Style::default().bg(Color::Rgb(50, 50, 50)).fg(Color::White);

    let status_line = Line::from(vec![
        Span::styled(
            format!(" {} ", mode_str),
            status_style.bg(Color::Blue).add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!(" {}{} ", fname, mod_indicator), status_style),
        Span::styled(
            " ".repeat(status_area.width.saturating_sub(
                (mode_str.len()
                    + 2
                    + fname.len()
                    + mod_indicator.len()
                    + 2
                    + pos_indicator.len()
                    + 2) as u16,
            ) as usize),
            status_style,
        ),
        Span::styled(format!(" {} ", pos_indicator), status_style),
    ]);
    frame.render_widget(Paragraph::new(status_line), status_area);

    let cmd_line = match editor.mode {
        Mode::Command => Line::from(vec![
            Span::styled(":", Style::default().fg(Color::Yellow)),
            Span::raw(&editor.cmd_input),
        ]),
        Mode::Search => Line::from(vec![
            Span::styled("/", Style::default().fg(Color::Yellow)),
            Span::raw(&editor.cmd_input),
        ]),
        _ => {
            if let Some(ref msg) = editor.status_message {
                Line::from(Span::styled(msg.clone(), Style::default().fg(Color::Cyan)))
            } else {
                Line::from("")
            }
        }
    };
    frame.render_widget(Paragraph::new(cmd_line), cmd_area);

    match editor.mode {
        Mode::Normal | Mode::Insert => {
            let cursor_x =
                editor_area.x + (editor.cursor_col.saturating_sub(editor.scroll_col)) as u16;
            let cursor_y =
                editor_area.y + (editor.cursor_row.saturating_sub(editor.scroll_row)) as u16;
            frame.set_cursor_position((cursor_x, cursor_y));
        }
        Mode::Command | Mode::Search => {
            let cursor_x = cmd_area.x + 1 + editor.cmd_cursor as u16;
            let cursor_y = cmd_area.y;
            frame.set_cursor_position((cursor_x, cursor_y));
        }
    }
}
