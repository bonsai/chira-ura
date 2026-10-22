# Storage System (Loose Connection Join)

**Storage Overview**

The chira-ura extension uses a storage system with loose connection join for flexibility:

## Database (DB)

- `packages/crx/storage/db.js` - Chrome storage local wrapper
  - Keys: NOTE, DEFAULT_BOX, GAS_URL
  - Methods: get(), set(), getNote(), setGasUrl(), getGasUrl(), getDefaultBox(), setDefaultBox()

- `packages/cli/ura-db.js` - SQLite-based storage
  - File: `~/.chira/ura.db`
  - Stores: notes, meta, schema
  - Syncs with extension via JSONL

## Wiki Integration

The wiki (Windows path `C:\Users\0501JP\wiki\ura`) can be integrated with:

- **CLI**: Add `wiki` command for sync/push to wiki folder
- **Bridge**: Add wiki as an optional target alongside GDrive
- **Local storage**: Use wiki folder for file-based storage when no GDrive

## Loose Connection Join Pattern

This design allows:
1. **Partial sync** between DB and CLI
2. **Multiple targets** (GDrive, GitHub, Box, Wiki)
3. **Graceful degradation** if one storage fails
4. **Backup strategies** with file-based storage

## Configuration

```bash
# CLI keys file (non-secret keys only)
~/.config/chira-ura/keys.json

# DB path (can be overridden)
export CHIRA_DB=~/.chira/ura.db

# Load directory (where dist/chira-ura-crx exists)
export CHIRA_LOAD_DIR=/path/to/chira-ura-crx
```

## Usage Commands

```bash
chira storage export [file]        # Export chrome.storage.local JSON
chira storage import <file>        # Import JSON to chrome.storage.local
chira wiki sync                    # Sync notes to wiki folder
chira wiki push                    # Push notes to wiki folder
```

## File Formats

- **DB**: SQLite with journal_mode = DELETE (single file per device)
- **JSONL**: Box file format for notes
- **JSON**: chrome.storage.local equivalent

## Integration Notes

- Wiki storage is **read-only** from CLI perspective
- CLI writes to GDrive as master, pulls changes to extension
- Extension writes to local storage (chrome.storage.local)
- Manual push/sync required for wiki integration

## Migration

To integrate wiki storage:

1. Add wiki folder to CLI configuration
2. Implement wiki sync logic
3. Update bridge server to include wiki target
4. Add wiki commands to CLI

## Final State

The system currently:
- ✅ Uses Chrome storage.local for extension state
- ✅ Uses SQLite for notes and metadata
- ❌ Wiki storage is not yet implemented
- ❌ Loose connection join pattern is conceptual
- ❌ CLI wiki sync commands don't exist

**Next Steps:**
Implement wiki storage commands and integrate with loose connection join pattern.