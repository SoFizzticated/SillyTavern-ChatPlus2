/**
 * ChatPlus 2 - Main Application Coordinator
 *
 * Coordinates all modules, manages initialization sequence,
 * and provides the central control point for the extension.
 *
 * @module ChatPlusCoordinator
 */

import StateManager from '../modules/state-manager.js';
import ChatRepository from '../modules/chat-repository.js';
import PinnedChatsManager from '../modules/pinned-chats.js';
import FolderSystemManager from '../modules/folder-system.js';
import RecentChatsView from '../modules/recent-chats.js';
import FoldersView from '../modules/folders-view.js';
import TabController from '../modules/tab-controller.js';
import SearchFilter from '../modules/search-filter.js';
import UIRenderer from '../modules/ui-renderer.js';
import EventHandlers from '../utils/event-handlers.js';
import * as CoreAPI from '../modules/core-api.js';

/**
 * Main coordinator class that wires all modules together
 */
class ChatPlusCoordinator {
    constructor() {
        // Module instances
        this.stateManager = null;
        this.chatRepository = null;
        this.pinnedChatsManager = null;
        this.folderSystemManager = null;
        this.recentChatsView = null;
        this.foldersView = null;
        this.tabController = null;
        this.searchFilter = null;
        this.uiRenderer = null;
        this.eventHandlers = null;

        // Initialization state
        this.initialized = false;
        this.initializationError = null;
    }

    /**
     * Initialize the ChatPlus 2 extension
     *
     * Runs the complete initialization sequence:
     * - Phase 1: Core State (StateManager)
     * - Phase 2: Data Layer (ChatRepository)
     * - Phase 3: Feature Modules (PinnedChats, FolderSystem)
     * - Phase 4: Initial UI Render (placeholder for now)
     * - Phase 5: Event Handlers
     *
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    async init() {
        if (this.initialized) {
            console.warn('[ChatPlus2] Coordinator already initialized');
            return true;
        }

        console.log('[ChatPlus2] Coordinator initialization starting...');

        try {
            // ========================================
            // PHASE 1: CORE STATE
            // ========================================
            console.debug('[ChatPlus2] Phase 1: Initializing StateManager...');

            this.stateManager = new StateManager();
            const settings = this.stateManager.load();
            CoreAPI.registerModule('StateManager', this.stateManager);

            console.debug('[ChatPlus2] StateManager initialized:', {
                pinnedChats: settings.pinnedChats.length,
                folders: settings.folders.length,
                chatFoldersCount: Object.keys(settings.chatFolders).length,
                defaultTab: settings.defaultTab,
                enabled: settings.enabled
            });

            // Check if extension is enabled
            if (!settings.enabled) {
                console.warn('[ChatPlus2] Extension is disabled in settings');
                CoreAPI.showToast('ChatPlus 2 is disabled. Enable it in settings.', 'warning');
                return false;
            }

            // ========================================
            // PHASE 2: DATA LAYER
            // ========================================
            console.debug('[ChatPlus2] Phase 2: Initializing ChatRepository...');

            this.chatRepository = new ChatRepository();
            CoreAPI.registerModule('ChatRepository', this.chatRepository);

            console.debug('[ChatPlus2] Fetching all chats...');
            const chats = await this.chatRepository.fetchAllChats();

            console.debug('[ChatPlus2] ChatRepository initialized:', {
                totalChats: chats.length,
                cacheSize: this.chatRepository.chatCache?.size || 0
            });

            // ========================================
            // PHASE 3: FEATURE MODULES
            // ========================================
            console.debug('[ChatPlus2] Phase 3: Initializing feature modules...');

            // Initialize PinnedChatsManager
            this.pinnedChatsManager = new PinnedChatsManager(this.stateManager);
            CoreAPI.registerModule('PinnedChatsManager', this.pinnedChatsManager);

            // Clean orphaned pins
            const removedPins = await this.pinnedChatsManager.cleanOrphanedPins();
            if (removedPins.length > 0) {
                console.debug(`[ChatPlus2] Cleaned ${removedPins.length} orphaned pinned chats`);
            }

            console.debug('[ChatPlus2] PinnedChatsManager initialized:', {
                pinnedCount: this.pinnedChatsManager.getPinnedKeys().length,
                orphansRemoved: removedPins.length
            });

            // Initialize FolderSystemManager
            this.folderSystemManager = new FolderSystemManager(this.stateManager);
            CoreAPI.registerModule('FolderSystemManager', this.folderSystemManager);

            // Clean orphaned folder assignments
            const orphanedAssignments = this.folderSystemManager.cleanOrphanedAssignments();
            if (orphanedAssignments > 0) {
                console.debug(`[ChatPlus2] Cleaned ${orphanedAssignments} orphaned folder assignments`);
            }

            console.debug('[ChatPlus2] FolderSystemManager initialized:', {
                folderCount: this.folderSystemManager.getFolderCount(),
                orphansRemoved: orphanedAssignments
            });

            // Initialize RecentChatsView
            this.recentChatsView = new RecentChatsView(
                this.chatRepository,
                this.pinnedChatsManager
            );
            CoreAPI.registerModule('RecentChatsView', this.recentChatsView);

            console.debug('[ChatPlus2] RecentChatsView initialized');

            // Initialize TabController
            this.tabController = new TabController(this.stateManager);
            CoreAPI.registerModule('TabController', this.tabController);

            console.debug('[ChatPlus2] TabController initialized');

            // Initialize SearchFilter
            this.searchFilter = new SearchFilter();
            CoreAPI.registerModule('SearchFilter', this.searchFilter);

            console.debug('[ChatPlus2] SearchFilter initialized', '(init() will wire DOM in Phase 4)');

            // Initialize UIRenderer (shared stateless DOM factory)
            this.uiRenderer = new UIRenderer();
            CoreAPI.registerModule('UIRenderer', this.uiRenderer);

            console.debug('[ChatPlus2] UIRenderer initialized');

            // Initialize FoldersView
            this.foldersView = new FoldersView(this.folderSystemManager, this.chatRepository);
            CoreAPI.registerModule('FoldersView', this.foldersView);

            console.debug('[ChatPlus2] FoldersView initialized');

            // ========================================
            // PHASE 4: INITIAL UI RENDER
            // ========================================
            // Activate the default tab. TabController emits 'tab-activated' which
            // triggers lazy rendering in RecentChatsView and future modules.
            console.debug('[ChatPlus2] Phase 4: Activating default tab...');

            this.tabController.init();

            // Wire search bar DOM elements now that the HTML is fully injected
            this.searchFilter.init();

            console.debug('[ChatPlus2] Default tab activated, lazy rendering in flight');

            // ========================================
            // PHASE 5: EVENT HANDLERS
            // ========================================
            console.debug('[ChatPlus2] Phase 5: Setting up event handlers...');

            this.setupEventListeners();

            console.debug('[ChatPlus2] Event handlers registered');

            // ========================================
            // INITIALIZATION COMPLETE
            // ========================================
            this.initialized = true;
            console.log('[ChatPlus2] ✅ Coordinator initialization complete!');

            // Expose debug interface
            this._exposeDebugInterface();

            return true;

        } catch (error) {
            this.initializationError = error;
            console.error('[ChatPlus2] ❌ Coordinator initialization failed:', error);
            CoreAPI.showToast('ChatPlus 2 initialization failed. Check console for details.', 'error');
            return false;
        }
    }

    /**
     * Set up event listeners for SillyTavern events.
     * Delegates all handler logic to EventHandlers.
     * @private
     */
    setupEventListeners() {
        this.eventHandlers = new EventHandlers({
            stateManager: this.stateManager,
            chatRepository: this.chatRepository,
            pinnedChatsManager: this.pinnedChatsManager,
            folderSystemManager: this.folderSystemManager,
            recentChatsView: this.recentChatsView,
        });
        this.eventHandlers.register();
    }

    /**
     * Clean up and destroy the coordinator
     * Used when disabling or reloading the extension
     */
    destroy() {
        console.log('[ChatPlus2] Destroying coordinator...');

        // Remove all ST event listeners
        this.eventHandlers?.destroy();
        this.eventHandlers = null;

        // Clear module references
        this.stateManager = null;
        this.chatRepository = null;
        this.pinnedChatsManager = null;
        this.folderSystemManager = null;
        this.recentChatsView?.destroy();
        this.recentChatsView = null; this.foldersView?.destroy();
        this.foldersView = null; this.tabController?.destroy();
        this.tabController = null;
        this.searchFilter?.destroy();
        this.searchFilter = null;
        this.uiRenderer = null;

        this.initialized = false;
        this.initializationError = null;

        console.log('[ChatPlus2] Coordinator destroyed');
    }

    /**
     * Expose debug interface for console access
     * @private
     */
    _exposeDebugInterface() {
        window._chatPlus2Debug = {
            coordinator: this,

            getDebugInfo: () => {
                return {
                    initialized: this.initialized,
                    error: this.initializationError,
                    modules: {
                        stateManager: !!this.stateManager,
                        chatRepository: !!this.chatRepository,
                        pinnedChatsManager: !!this.pinnedChatsManager,
                        folderSystemManager: !!this.folderSystemManager
                    },
                    settings: this.stateManager?.get() || null,
                    stats: {
                        totalChats: this.chatRepository?.chatCache?.size || 0,
                        pinnedChats: this.pinnedChatsManager?.getPinnedKeys().length || 0,
                        folders: this.folderSystemManager?.getFolderCount() || 0
                    }
                };
            },

            forceReload: async () => {
                console.log('[ChatPlus2 Debug] Force reloading...');

                if (this.chatRepository) {
                    this.chatRepository.clearCache();
                    await this.chatRepository.fetchAllChats();
                }

                // Re-render UI
                await this.recentChatsView?.refresh();

                console.log('[ChatPlus2 Debug] Reload complete');
                return window._chatPlus2Debug.getDebugInfo();
            },

            exportState: () => {
                return {
                    settings: this.stateManager?.get() || null,
                    timestamp: new Date().toISOString()
                };
            }
        };

        console.log('[ChatPlus2] Debug interface available at window._chatPlus2Debug');
    }
}

// Create and export singleton instance
export const chatPlusCoordinator = new ChatPlusCoordinator();
export default chatPlusCoordinator;
