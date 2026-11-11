import 'dart:convert';
import 'package:http/http.dart' as http;
import '../model/note.dart';
import '../storage/outbox_store.dart';

class SyncBatchResult {
  final bool success;
  final int syncedCount;
  final int remainingCount;
  final String? errorMessage;

  const SyncBatchResult({
    required this.success,
    required this.syncedCount,
    required this.remainingCount,
    this.errorMessage,
  });
}

/// Service that syncs local offline notes to Cloudflare Worker FE API (api/).
/// Endpoint: `PUT /inbox/<id>.txt`
/// Batch size: 10 items per push, matching cli/wiki-push.js and mobile-design.md
class SyncService {
  final OutboxStore outboxStore;
  final String apiUrl;
  final String? apiToken;
  final http.Client _client;
  static const int defaultBatchSize = 10;

  SyncService({
    required this.outboxStore,
    required this.apiUrl,
    this.apiToken,
    http.Client? client,
  }) : _client = client ?? http.Client();

  /// Formats note filename as `<id>.txt` matching gui/win and gui/rust
  static String formatFileName(String id) => '$id.txt';

  /// Sends a single note payload to FE API: `PUT /inbox/<name>`
  /// Payload schema: { content, updatedAt, closed, title }
  Future<bool> sendNote(Note note, {bool closed = false}) async {
    final cleanBase = apiUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$cleanBase/inbox/${formatFileName(note.id)}');

    final headers = <String, String>{
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (apiToken != null && apiToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $apiToken';
    }

    final body = jsonEncode({
      'title': note.title,
      'content': note.content,
      'updatedAt': note.updatedAt,
      'closed': closed,
    });

    try {
      final response = await _client
          .put(uri, headers: headers, body: body)
          .timeout(const Duration(seconds: 4));

      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      // Offline or network error: return false to keep note in outbox
      return false;
    }
  }

  /// Syncs pending notes in chunks of [batchSize] (default 10).
  /// Idempotent: once successfully delivered, the item is removed from outbox.
  /// If network fails mid-batch, halts and preserves unsent notes for next attempt.
  Future<SyncBatchResult> syncPending({int batchSize = defaultBatchSize}) async {
    final pendingNotes = await outboxStore.listNotes();
    if (pendingNotes.isEmpty) {
      return const SyncBatchResult(
        success: true,
        syncedCount: 0,
        remainingCount: 0,
      );
    }

    // Take up to batchSize items (oldest first)
    final batch = pendingNotes.take(batchSize).toList();
    int syncedCount = 0;

    for (final note in batch) {
      final sent = await sendNote(note);
      if (sent) {
        await outboxStore.removeNote(note.id);
        syncedCount++;
      } else {
        // Network failure: break early without removing unsent items
        final remaining = (await outboxStore.listNotes()).length;
        return SyncBatchResult(
          success: false,
          syncedCount: syncedCount,
          remainingCount: remaining,
          errorMessage: 'Failed to send note ${note.id} to FE API',
        );
      }
    }

    final remaining = (await outboxStore.listNotes()).length;
    return SyncBatchResult(
      success: true,
      syncedCount: syncedCount,
      remainingCount: remaining,
    );
  }

  /// Flushes all pending notes in sequential batches of [batchSize].
  Future<SyncBatchResult> flushAll({int batchSize = defaultBatchSize}) async {
    int totalSynced = 0;
    while (true) {
      final res = await syncPending(batchSize: batchSize);
      totalSynced += res.syncedCount;
      if (!res.success || res.remainingCount == 0 || res.syncedCount == 0) {
        return SyncBatchResult(
          success: res.success,
          syncedCount: totalSynced,
          remainingCount: res.remainingCount,
          errorMessage: res.errorMessage,
        );
      }
    }
  }
}
