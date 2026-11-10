import 'dart:async';
import 'package:flutter/material.dart';
import '../model/note.dart';
import '../storage/outbox_store.dart';
import '../sync/sync_service.dart';

class StickyNotePage extends StatefulWidget {
  final OutboxStore outboxStore;
  final SyncService? syncService;

  const StickyNotePage({
    super.key,
    required this.outboxStore,
    this.syncService,
  });

  @override
  State<StickyNotePage> createState() => _StickyNotePageState();
}

class _StickyNotePageState extends State<StickyNotePage> {
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();
  Note? _currentNote;
  Timer? _debounceTimer;
  String _status = '📝';
  int _pendingCount = 0;
  bool _isSyncing = false;

  @override
  void initState() {
    super.initState();
    _startNewNote();
    _refreshPendingCount();

    // Trigger auto-sync on startup if online
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
      _tryAutoSync();
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _startNewNote() {
    _debounceTimer?.cancel();
    setState(() {
      _currentNote = Note.create('');
      _controller.text = '';
      _status = '📝';
    });
    _focusNode.requestFocus();
  }

  Future<void> _refreshPendingCount() async {
    final notes = await widget.outboxStore.listNotes();
    if (mounted) {
      setState(() {
        _pendingCount = notes.length;
      });
    }
  }

  void _onTextChanged(String text) {
    setState(() {
      _status = '✏️';
    });
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 350), () async {
      await _saveCurrentNote();
    });
  }

  Future<void> _saveCurrentNote() async {
    final text = _controller.text;
    if (_currentNote == null) return;

    if (text.trim().isEmpty) {
      if (mounted) {
        setState(() {
          _status = '📝';
        });
      }
      return;
    }

    final updated = _currentNote!.copyWithContent(text);
    _currentNote = updated;
    await widget.outboxStore.saveNote(updated);
    await _refreshPendingCount();

    if (mounted) {
      setState(() {
        _status = '💾';
      });
    }
  }

  Future<void> _tryAutoSync() async {
    if (widget.syncService == null || _isSyncing) return;
    setState(() {
      _isSyncing = true;
    });

    final res = await widget.syncService!.flushAll(batchSize: 10);
    await _refreshPendingCount();

    if (mounted) {
      setState(() {
        _isSyncing = false;
        if (res.syncedCount > 0) {
          _status = '☁️';
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Styling matching sticky note theme in gui/win and gui/rust:
    // Warm sticky paper color (#FFFBEA / Amber-50), dark ink text
    const backgroundColor = Color(0xFFFFFBEA);
    const borderColor = Color(0xFFE2D9B8);
    const inkColor = Color(0xFF222222);

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        backgroundColor: backgroundColor,
        elevation: 0,
        scrolledUnderElevation: 0,
        title: Row(
          children: [
            Text(
              _status,
              style: const TextStyle(fontSize: 20),
            ),
            const SizedBox(width: 8),
            Text(
              'チラ裏 ($_pendingCount)',
              style: const TextStyle(
                color: inkColor,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '同期（送信）',
            icon: _isSyncing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync, color: inkColor),
            onPressed: _isSyncing ? null : _tryAutoSync,
          ),
          IconButton(
            tooltip: '新規メモ (＋)',
            icon: const Icon(Icons.add, color: inkColor),
            onPressed: () async {
              await _saveCurrentNote();
              _startNewNote();
            },
          ),
        ],
      ),
      body: Container(
        decoration: const BoxDecoration(
          border: Border(
            top: BorderSide(color: borderColor, width: 1.0),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
          child: TextField(
            controller: _controller,
            focusNode: _focusNode,
            onChanged: _onTextChanged,
            maxLines: null,
            expands: true,
            // Japanese IME friendly default configuration:
            // keyboardType multiline, textCapitalization none
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.none,
            autofocus: true,
            style: const TextStyle(
              fontSize: 16.0,
              color: inkColor,
              height: 1.5,
            ),
            decoration: const InputDecoration(
              hintText: '書いたら即保存（チラ裏）...',
              hintStyle: TextStyle(color: Color(0xFF999580)),
              border: InputBorder.none,
            ),
          ),
        ),
      ),
    );
  }
}
