import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'storage/outbox_store.dart';
import 'sync/sync_service.dart';
import 'ui/sticky_note_page.dart';

void main() async {
  // Ensure fast startup (< 300ms) with minimal bootstrap overhead
  WidgetsFlutterBinding.ensureInitialized();

  // Edge-to-edge transparent system navigation
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );

  final outboxStore = await OutboxStore.createDefault();

  // Load API config from environment if provided
  final apiUrl = Platform.environment['CHIRA_API_URL'] ??
      const String.fromEnvironment('CHIRA_API_URL', defaultValue: 'https://api.chira-ura.workers.dev');
  final apiToken = Platform.environment['CHIRA_TOKEN'] ??
      const String.fromEnvironment('CHIRA_TOKEN', defaultValue: '');

  final syncService = SyncService(
    outboxStore: outboxStore,
    apiUrl: apiUrl,
    apiToken: apiToken.isNotEmpty ? apiToken : null,
  );

  runApp(ChiraMobileApp(
    outboxStore: outboxStore,
    syncService: syncService,
  ));
}

class ChiraMobileApp extends StatelessWidget {
  final OutboxStore outboxStore;
  final SyncService? syncService;

  const ChiraMobileApp({
    super.key,
    required this.outboxStore,
    this.syncService,
  });

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'チラ裏',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFFFFBEA),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFE2D9B8),
          surface: const Color(0xFFFFFBEA),
        ),
      ),
      home: StickyNotePage(
        outboxStore: outboxStore,
        syncService: syncService,
      ),
    );
  }
}
