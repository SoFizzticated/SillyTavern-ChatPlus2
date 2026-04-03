// TODO: Remove
/**
 * ChatPlus 2 - Chat Identifier Usage Examples
 *
 * This file demonstrates how to use the chat-identifier utility.
 * These examples can be tested in the browser console.
 */

import ChatIdentifier from './chat-identifier.js';

// Example 1: Generate chat key from chat object
const exampleChat = {
    avatar: 'Seraphina.png',
    file_name: 'casual_chat.jsonl'
};

try {
    const key = ChatIdentifier.getChatKey(exampleChat);
    console.log('Chat key:', key);
    // Output: "Seraphina.png:casual_chat"
} catch (error) {
    console.error('Error generating key:', error);
}

// Example 2: Parse chat key back into components
const chatKey = 'Seraphina.png:casual_chat';
try {
    const { avatar, fileName } = ChatIdentifier.parseChatKey(chatKey);
    console.log('Avatar:', avatar); // "Seraphina.png"
    console.log('File name:', fileName); // "casual_chat"
} catch (error) {
    console.error('Error parsing key:', error);
}

// Example 3: Validate chat object
const validChat = { avatar: 'Alice.png', file_name: 'chat1' };
const invalidChat = { avatar: '', file_name: 'chat1' };

console.log('Valid chat?', ChatIdentifier.isValidChat(validChat)); // true
console.log('Invalid chat?', ChatIdentifier.isValidChat(invalidChat)); // false

// Example 4: Get entity by avatar (async)
async function findCharacter() {
    const entity = await ChatIdentifier.getEntityByAvatar('Seraphina.png');
    if (entity) {
        console.log(entity.isGroup ? 'Group:' : 'Character:', entity.name);
    } else {
        console.log('Character/group not found');
    }
}

// Example 5: Check if key matches avatar
const key = 'Seraphina.png:casual_chat';
const targetAvatar = 'Seraphina.png';

if (ChatIdentifier.chatKeyMatchesAvatar(key, targetAvatar)) {
    console.log('This chat belongs to Seraphina');
}

// Example 6: Extract components without full parsing (more efficient)
const quickAvatar = ChatIdentifier.extractAvatarFromKey(key);
const quickFileName = ChatIdentifier.extractFileNameFromKey(key);
console.log('Quick extraction:', quickAvatar, quickFileName);

// Example 7: Build chat object from key
const parsedKey = ChatIdentifier.parseChatKey('Alice.png:conversation');
const rebuiltChat = ChatIdentifier.buildChatObject(parsedKey.avatar, parsedKey.fileName);
console.log('Rebuilt chat:', rebuiltChat);
// Output: { avatar: "Alice.png", file_name: "conversation" }

// Example 8: Compare chat keys
const key1 = 'Alice.png:chat1';
const key2 = 'Alice.png:chat1';
const key3 = 'Bob.png:chat1';

console.log('Keys match?', ChatIdentifier.compareChatKeys(key1, key2)); // true
console.log('Keys match?', ChatIdentifier.compareChatKeys(key1, key3)); // false

/**
 * Real-world usage example: Managing pinned chats
 */
class PinnedChatsExample {
    constructor() {
        this.pinnedChats = []; // Array of chat keys
    }

    /**
     * Pin a chat
     */
    pin(chat) {
        if (!ChatIdentifier.isValidChat(chat)) {
            throw new Error('Invalid chat object');
        }

        const key = ChatIdentifier.getChatKey(chat);

        if (!this.pinnedChats.includes(key)) {
            this.pinnedChats.push(key);
            console.log('Pinned:', key);
        }
    }

    /**
     * Unpin a chat
     */
    unpin(chat) {
        const key = ChatIdentifier.getChatKey(chat);
        const index = this.pinnedChats.indexOf(key);

        if (index !== -1) {
            this.pinnedChats.splice(index, 1);
            console.log('Unpinned:', key);
        }
    }

    /**
     * Check if chat is pinned
     */
    isPinned(chat) {
        const key = ChatIdentifier.getChatKey(chat);
        return this.pinnedChats.includes(key);
    }

    /**
     * Get all pinned chats for a specific character
     */
    getPinnedByAvatar(avatar) {
        return this.pinnedChats.filter(key =>
            ChatIdentifier.chatKeyMatchesAvatar(key, avatar)
        );
    }
}

// Usage:
const manager = new PinnedChatsExample();
manager.pin({ avatar: 'Alice.png', file_name: 'chat1' });
manager.pin({ avatar: 'Alice.png', file_name: 'chat2' });
manager.pin({ avatar: 'Bob.png', file_name: 'chat1' });

console.log('Alice\'s pinned chats:', manager.getPinnedByAvatar('Alice.png'));
// Output: ["Alice.png:chat1", "Alice.png:chat2"]
