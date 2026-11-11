import 'package:flutter_test/flutter_test.dart';
import 'package:chira_mobile/model/note.dart';

void main() {
  group('Note Model & Schema', () {
    test('deriveTitle extracts first non-empty line up to 30 runes', () {
      expect(Note.deriveTitle(''), '無題');
      expect(Note.deriveTitle('   \n\n  こんにちは世界'), 'こんにちは世界');
      final longText = 'あ' * 45;
      expect(Note.deriveTitle(longText), 'あ' * 30);
      expect(Note.deriveTitle('\n\n1行目\n2行目'), '1行目');
    });

    test('Note canonical serialization and deserialization', () {
      final now = 1730000000000;
      final note = Note(
        id: 'note-1730000000000-abcd',
        title: 'テストタイトル',
        content: 'テストタイトル\n2行目の本文',
        updatedAt: now,
      );

      final json = note.toJson();
      expect(json['id'], 'note-1730000000000-abcd');
      expect(json['title'], 'テストタイトル');
      expect(json['content'], 'テストタイトル\n2行目の本文');
      expect(json['updatedAt'], now);

      final restored = Note.fromJson(json);
      expect(restored, note);
      expect(restored.id, note.id);
      expect(restored.title, note.title);
      expect(restored.content, note.content);
      expect(restored.updatedAt, note.updatedAt);
    });

    test('Note.create initializes with valid id and timestamp', () {
      final note = Note.create('新しいメモ');
      expect(note.id, startsWith('note-'));
      expect(note.title, '新しいメモ');
      expect(note.content, '新しいメモ');
      expect(note.updatedAt, greaterThan(0));
    });

    test('copyWithContent updates title, content and timestamp', () {
      final note = Note.create('初期内容', 1000);
      final updated = note.copyWithContent('更新内容', 2000);

      expect(updated.id, note.id);
      expect(updated.title, '更新内容');
      expect(updated.content, '更新内容');
      expect(updated.updatedAt, 2000);
    });
  });
}
