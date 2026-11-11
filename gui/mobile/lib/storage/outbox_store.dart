import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../model/note.dart';

/// Local offline storage for notes.
/// Saves each note as an independent JSON file `<id>.json` in the outbox directory,
/// matching the outbox design of gui/rust and offline queues of gui/win.
class OutboxStore {
  final Directory dir;

  OutboxStore({required this.dir});

  static Future<OutboxStore> createDefault() async {
    final baseDir = await getApplicationDocumentsDirectory();
    final outboxDir = Directory('${baseDir.path}/chira/outbox');
    if (!await outboxDir.exists()) {
      await outboxDir.create(recursive: true);
    }
    return OutboxStore(dir: outboxDir);
  }

  /// Saves or overwrites a note in outbox
  Future<File> saveNote(Note note) async {
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    final file = File('${dir.path}/${note.id}.json');
    final encoder = const JsonEncoder.withIndent('  ');
    await file.writeAsString(encoder.convert(note.toJson()));
    return file;
  }

  /// Reads a specific note by ID
  Future<Note?> getNote(String id) async {
    final file = File('${dir.path}/$id.json');
    if (!await file.exists()) {
      return null;
    }
    try {
      final text = await file.readAsString();
      final map = jsonDecode(text) as Map<String, dynamic>;
      return Note.fromJson(map);
    } catch (_) {
      return null;
    }
  }

  /// Lists all notes in outbox sorted chronologically by updatedAt ascending (oldest first)
  Future<List<Note>> listNotes() async {
    if (!await dir.exists()) {
      return [];
    }

    final notes = <Note>[];
    await for (final entity in dir.list()) {
      if (entity is File && entity.path.endsWith('.json')) {
        try {
          final content = await entity.readAsString();
          final map = jsonDecode(content) as Map<String, dynamic>;
          notes.add(Note.fromJson(map));
        } catch (_) {
          // Ignore corrupted or partial writes
        }
      }
    }

    notes.sort((a, b) => a.updatedAt.compareTo(b.updatedAt));
    return notes;
  }

  /// Removes note from outbox upon successful delivery
  Future<bool> removeNote(String id) async {
    final file = File('${dir.path}/$id.json');
    if (await file.exists()) {
      await file.delete();
      return true;
    }
    return false;
  }

  /// Clears all notes in outbox (useful for test resets)
  Future<void> clear() async {
    if (await dir.exists()) {
      await for (final entity in dir.list()) {
        if (entity is File) {
          await entity.delete();
        }
      }
    }
  }
}
