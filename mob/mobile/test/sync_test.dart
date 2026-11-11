import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:chira_mobile/model/note.dart';
import 'package:chira_mobile/storage/outbox_store.dart';
import 'package:chira_mobile/sync/sync_service.dart';

void main() {
  group('SyncService FE API Sync', () {
    late Directory tempDir;
    late OutboxStore store;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('chira_sync_test_');
      store = OutboxStore(dir: tempDir);
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('sends notes in batches of 10 and delivers to PUT /inbox/<id>.txt', () async {
      final receivedRequests = <http.Request>[];

      final mockClient = MockClient((request) async {
        if (request.method == 'PUT' && request.url.path.startsWith('/inbox/')) {
          receivedRequests.add(request as http.Request);
          return http.Response(
            jsonEncode({'ok': true, 'name': request.url.pathSegments.last}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('Not Found', 404);
      });

      // Populate 25 notes into offline outbox
      for (int i = 1; i <= 25; i++) {
        final note = Note(
          id: 'note-$i',
          title: 'メモ $i',
          content: 'メモ本文 $i',
          updatedAt: 1000 + i,
        );
        await store.saveNote(note);
      }

      final syncService = SyncService(
        outboxStore: store,
        apiUrl: 'https://test-worker.dev',
        apiToken: 'secret-token-123',
        client: mockClient,
      );

      // First batch: exactly 10 notes
      final res1 = await syncService.syncPending(batchSize: 10);
      expect(res1.success, isTrue);
      expect(res1.syncedCount, 10);
      expect(res1.remainingCount, 15);
      expect(receivedRequests.length, 10);

      // Verify request properties
      expect(receivedRequests.first.url.toString(), 'https://test-worker.dev/inbox/note-1.txt');
      expect(receivedRequests.first.headers['authorization'], 'Bearer secret-token-123');

      // Second batch: next 10 notes
      final res2 = await syncService.syncPending(batchSize: 10);
      expect(res2.success, isTrue);
      expect(res2.syncedCount, 10);
      expect(res2.remainingCount, 5);
      expect(receivedRequests.length, 20);

      // Remaining 5 notes
      final res3 = await syncService.syncPending(batchSize: 10);
      expect(res3.success, isTrue);
      expect(res3.syncedCount, 5);
      expect(res3.remainingCount, 0);
      expect(receivedRequests.length, 25);
    });

    test('idempotency: re-executing sync when outbox is empty sends nothing', () async {
      int callCount = 0;
      final mockClient = MockClient((request) async {
        callCount++;
        return http.Response('{"ok":true}', 200);
      });

      final syncService = SyncService(
        outboxStore: store,
        apiUrl: 'https://test-worker.dev',
        client: mockClient,
      );

      final res = await syncService.syncPending();
      expect(res.success, isTrue);
      expect(res.syncedCount, 0);
      expect(res.remainingCount, 0);
      expect(callCount, 0);
    });

    test('network failure halts batch and preserves unsent notes in outbox', () async {
      int requestIndex = 0;
      final mockClient = MockClient((request) async {
        requestIndex++;
        if (requestIndex <= 3) {
          return http.Response('{"ok":true}', 200);
        }
        // 4th request throws network error
        throw const SocketException('Connection refused / offline');
      });

      for (int i = 1; i <= 6; i++) {
        await store.saveNote(Note(
          id: 'note-$i',
          title: 'メモ $i',
          content: '本文 $i',
          updatedAt: 1000 + i,
        ));
      }

      final syncService = SyncService(
        outboxStore: store,
        apiUrl: 'https://test-worker.dev',
        client: mockClient,
      );

      final res = await syncService.syncPending(batchSize: 10);
      expect(res.success, isFalse);
      expect(res.syncedCount, 3);
      expect(res.remainingCount, 3); // 3 notes remain in outbox

      final remainingNotes = await store.listNotes();
      expect(remainingNotes.length, 3);
      expect(remainingNotes.map((n) => n.id), ['note-4', 'note-5', 'note-6']);
    });

    test('flushAll drains outbox completely across multiple 10-note batches', () async {
      final mockClient = MockClient((request) async {
        return http.Response('{"ok":true}', 200);
      });

      for (int i = 1; i <= 22; i++) {
        await store.saveNote(Note(
          id: 'note-$i',
          title: 'タイトル $i',
          content: '本文 $i',
          updatedAt: 1000 + i,
        ));
      }

      final syncService = SyncService(
        outboxStore: store,
        apiUrl: 'https://test-worker.dev',
        client: mockClient,
      );

      final res = await syncService.flushAll(batchSize: 10);
      expect(res.success, isTrue);
      expect(res.syncedCount, 22);
      expect(res.remainingCount, 0);
      expect((await store.listNotes()).isEmpty, isTrue);
    });
  });
}
