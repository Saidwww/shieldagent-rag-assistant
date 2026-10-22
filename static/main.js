// UI State
let chatHistory = [];

// DOM Elements
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const documentList = document.getElementById('document-list');
const docCountBadge = document.getElementById('doc-count');
const noDocsMessage = document.getElementById('no-documents');
const clearChatBtn = document.getElementById('clear-chat-btn');

// Upload DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadDocuments();
    setupUploadHandlers();
    
    // Clear chat button
    clearChatBtn.addEventListener('click', () => {
        chatHistory = [];
        chatMessages.innerHTML = `
            <div class="message system-message">
                <div class="message-content">
                    <i class="ph-fill ph-terminal-window"></i>
                    <p><strong>System initialized.</strong> I am your cyber security research assistant. Put security logs, writeups, or documentation in the knowledge base and ask me questions. Logs will be permanently archived in <code>chat_history_archive.md</code>.</p>
                </div>
            </div>
        `;
    });

    // Chat submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const messageText = chatInput.value.trim();
        if (!messageText) return;

        sendMessage(messageText);
        chatInput.value = '';
    });
});

// Load Documents from API
async function loadDocuments() {
    try {
        const response = await fetch('/api/documents');
        if (!response.ok) throw new Error('Failed to load documents');
        
        const docs = await response.json();
        renderDocuments(docs);
    } catch (err) {
        console.error('Error fetching documents:', err);
    }
}

// Render Document List in Sidebar
function renderDocuments(docs) {
    documentList.innerHTML = '';
    docCountBadge.textContent = `${docs.length} file${docs.length === 1 ? '' : 's'}`;

    if (docs.length === 0) {
        noDocsMessage.style.display = 'flex';
        return;
    }

    noDocsMessage.style.display = 'none';
    docs.forEach(doc => {
        const li = document.createElement('li');
        li.className = 'doc-item';
        
        const sizeKB = (doc.size / 1024).toFixed(1);
        
        li.innerHTML = `
            <div class="doc-info">
                <i class="ph-fill ph-file-text"></i>
                <div class="doc-meta">
                    <span class="doc-name" title="${doc.name}">${doc.name}</span>
                    <span class="doc-size">${sizeKB} KB</span>
                </div>
            </div>
        `;
        documentList.appendChild(li);
    });
}

// Setup Drag & Drop Upload Handlers
function setupUploadHandlers() {
    // Click drop-zone to open file browser
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFiles(e.target.files);
        }
    });

    // Drag-over styling
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            uploadFiles(files);
        }
    });
}

// Send Upload request to FastAPI
async function uploadFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    setUploadStatus('Uploading and indexing files...', 'loading');

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Failed to upload files');
        }

        const result = await response.json();
        setUploadStatus(`Indexed ${result.uploaded.length} file(s)!`, 'success');
        
        // Reload document list
        loadDocuments();
        
        // Clear status after 3 seconds
        setTimeout(() => {
            uploadStatus.className = 'upload-status';
            uploadStatus.textContent = '';
        }, 4000);
    } catch (err) {
        setUploadStatus(err.message, 'error');
    }
}

function setUploadStatus(text, type) {
    uploadStatus.textContent = text;
    uploadStatus.className = `upload-status ${type}`;
}

// Chat API Communication
async function sendMessage(question) {
    // Append User Message to UI
    appendMessage(question, 'user');
    
    // Add Typing Indicator
    const typingIndicator = appendTypingIndicator();
    scrollToBottom();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question,
                history: chatHistory
            })
        });

        if (!response.ok) {
            throw new Error('API server returned an error');
        }

        const data = await response.json();
        
        // Remove typing indicator
        typingIndicator.remove();

        // Append Assistant Message to UI
        appendMessage(data.answer, 'assistant', data.sources);
        
        // Save history state (limit history to last 10 messages to keep prompt length clean)
        chatHistory.push(["User", question]);
        chatHistory.push(["Assistant", data.answer]);
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(-20);
        }

    } catch (err) {
        typingIndicator.remove();
        appendMessage(`System Error: ${err.message}. Please ensure the server and Ollama are running.`, 'assistant');
    }
    
    scrollToBottom();
}

// Append Chat Message Bubbles
function appendMessage(text, role, sources = []) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    let contentHTML = `<div class="message-content">`;
    
    if (role === 'assistant') {
        contentHTML += formatMarkdown(text);
        
        // Add sources if any
        if (sources && sources.length > 0) {
            contentHTML += `
                <div class="sources-container">
                    <span class="sources-label"><i class="ph-bold ph-quotes"></i> Retrieved Sources:</span>
                    ${sources.map(s => `<span class="source-tag"><i class="ph ph-file-text"></i> ${s.source}</span>`).join('')}
                </div>
            `;
        }
    } else {
        contentHTML += `<p>${escapeHTML(text)}</p>`;
    }
    
    contentHTML += `</div>`;
    msgDiv.innerHTML = contentHTML;
    
    chatMessages.appendChild(msgDiv);
}

// Create Bouncing Dots Typing Indicator
function appendTypingIndicator() {
    const indicatorDiv = document.createElement('div');
    indicatorDiv.className = 'message assistant';
    indicatorDiv.innerHTML = `
        <div class="message-content">
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    chatMessages.appendChild(indicatorDiv);
    return indicatorDiv;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Helper to escape HTML tags (XSS mitigation)
function escapeHTML(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Simple Markdown Formatter for Code Blocks & Bold Text
function formatMarkdown(text) {
    if (!text) return "";
    let html = text;
    
    // Escape HTML first to prevent breakage
    html = escapeHTML(html);
        
    // 1. Code blocks (```lang ... ```)
    html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]+?)```/g, (match, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });
    
    // 2. Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 3. Strong bold (**bold**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 4. Bullet lists
    let lines = html.split('\n');
    let inList = false;
    let listFormattedLines = [];
    
    for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            if (!inList) {
                listFormattedLines.push('<ul>');
                inList = true;
            }
            listFormattedLines.push(`<li>${trimmed.substring(2)}</li>`);
        } else {
            if (inList) {
                listFormattedLines.push('</ul>');
                inList = false;
            }
            listFormattedLines.push(line);
        }
    }
    if (inList) {
        listFormattedLines.push('</ul>');
    }
    html = listFormattedLines.join('\n');
    
    // 5. Convert remaining single newlines to <br> (except inside pre blocks)
    let parts = html.split(/(<pre>[\s\S]*?<\/pre>)/);
    html = parts.map(part => {
        if (part.startsWith('<pre>')) {
            return part; 
        } else {
            return part.replace(/\n/g, '<br>');
        }
    }).join('');
    
    return html;
}
