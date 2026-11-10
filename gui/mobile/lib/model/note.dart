import 'dart:convert';
import 'dart:math';

/// Canonical note schema shared across crx, cli, win, and rust:
/// { id, title, content, updatedAt }
class Note {
  final String id;
  final String title;
  final String content;
  final int updatedAt;

  Note({
    required this.id,
    required this.title,
    required this.content,
    required this.updatedAt,
  });

  /// Derives a title from the first non-empty line of content, max 30 chars.
  /// Matches deriveTitle in model.js, Note.cs, and model.rs.
  static String deriveTitle(String? content) {
    if (content == null || content.isEmpty) {
      return '無題';
    }
    final lines = const LineSplitter().convert(content);
    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isNotEmpty) {
        return trimmed.runes.length <= 30
            ? trimmed
            : String.fromCharCodes(trimmed.runes.take(30));
      }
    }
    return '無題';
  }

  static const String _base36Chars = '0123456789abcdefghijklmnopqrstuvwxyz';

  static String _toBase36(int value, int minDigits) {
    if (value <= 0) return '0' * minDigits;
    var v = value;
    final sb = StringBuffer();
    while (v > 0) {
      sb.write(_base36Chars[v % 36]);
      v ~/= 36;
    }
    final reversed = sb.toString().split('').reversed.join('');
    if (reversed.length < minDigits) {
      return ('0' * (minDigits - reversed.length)) + reversed;
    }
    return reversed;
  }

  /// Generates note ID: `note-<timestamp>-<rand4>`
  static String newNoteId([int? now]) {
    final timestamp = now ?? DateTime.now().millisecondsSinceEpoch;
    final rand = _toBase36(Random().nextInt(1679616), 4);
    return 'note-$timestamp-$rand';
  }

  /// Creates a new note instance with auto-generated ID and title
  factory Note.create(String content, [int? now]) {
    final timestamp = now ?? DateTime.now().millisecondsSinceEpoch;
    return Note(
      id: newNoteId(timestamp),
      title: deriveTitle(content),
      content: content,
      updatedAt: timestamp,
    );
  }

  /// Returns a modified copy of this note with updated content and timestamp
  Note copyWithContent(String newContent, [int? now]) {
    final timestamp = now ?? DateTime.now().millisecondsSinceEpoch;
    return Note(
      id: id,
      title: deriveTitle(newContent),
      content: newContent,
      updatedAt: timestamp,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'content': content,
      'updatedAt': updatedAt,
    };
  }

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? deriveTitle(json['content'] as String?),
      content: json['content'] as String? ?? '',
      updatedAt: json['updatedAt'] is num
          ? (json['updatedAt'] as num).toInt()
          : (json['updated_at'] is num
              ? (json['updated_at'] as num).toInt()
              : DateTime.now().millisecondsSinceEpoch),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Note &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          title == other.title &&
          content == other.content &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode =>
      id.hashCode ^ title.hashCode ^ content.hashCode ^ updatedAt.hashCode;
}
