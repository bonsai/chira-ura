import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:chira_mobile/model/note.dart';
import 'package:chira_mobile/storage/outbox_store.dart';

void main() {
  group('OutboxStore Local Offline Storage', () {
    late Directory tempDir;
    late OutboxStore store;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('chira_outbox_test_');
      store = OutboxStore(dir: tempDir);
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('saveNote and getNote retrieve canonical note', () async {
      final note = Note(
        id: 'note-1',
        title: 'オフラインメモ',
        content: 'オフラインメモ本文',
        updatedAt: 1000,
      );

      await store.saveNote(note);
      final loaded = await store.getNote(note.id);

      expect(loaded, isNotNull);
      expect(loaded!.id, note.id);
      expect(loaded.title, note.title);
      expect(loaded.content, note.content);
      expect(loaded.updatedAt, note.updatedAt);
    });

    test('listNotes returns notes sorted chronologically ascending', () async {
      final n1 = Note(id: 'note-2', title: '2', content: '2', updatedAt: 2000);
      final n2 = Note(id: 'note-1', title: '1', content: '1', updatedAt: 1000);
      final n3 = Note(id: 'note-3', title: '3', content: '3', updatedAt: 3000);

      await store.saveNote(n1);
      await store.saveNote(n2);
      await store.saveNote(n3);

      final list = await store.listNotes();
      expect(list.length, 3);
      expect(list[0].id, 'note-1');
      expect(list[1].id, 'note-2');
      expect(list[2].id, 'note-3');
    });

    test('removeNote removes note from outbox', () async {
      final note = Note(id: 'note-del', title: '削除', content: '削除', updatedAt: 1000);
      await store.saveNote(note);

      expect((await store.listNotes()).length, 1);
      final removed = await store.removeNote(note.id);
      expect(removed, isTrue);

      expect((await store.listNotes()).length, 0);
      expect(await store.getNote(note.id), isNull);
    });
  });
}
