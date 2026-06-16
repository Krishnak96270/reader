// Register Service Worker for PWA compliance
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.error('Service Worker Registration Failed', err);
        });
    });
}

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const fileInput = document.getElementById('fileInput');
const contentDiv = document.getElementById('content');
const btnPlay = document.getElementById('btnPlay');
const btnPause = document.getElementById('btnPause');
const btnStop = document.getElementById('btnStop');
const btnRev10 = document.getElementById('btnRev10');
const btnFwd10 = document.getElementById('btnFwd10');
const btnRecord = document.getElementById('btnRecord');
const progressBar = document.getElementById('progressBar');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');
const statusIndicator = document.getElementById('statusIndicator');

const CHARS_PER_SEC = 15; // Estimating 15 characters per second for progress calc

let availableVoices = [];
window.speechSynthesis.onvoiceschanged = () => {
    availableVoices = window.speechSynthesis.getVoices();
};
availableVoices = window.speechSynthesis.getVoices();

function updateStatus(msg) {
    if (!msg) {
        statusIndicator.style.display = 'none';
    } else {
        statusIndicator.style.display = 'block';
        statusIndicator.textContent = msg;
    }
}

// File Input Handler
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    isStopped = true;
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel(); // Stop any ongoing speech
    contentDiv.innerHTML = '<p>Loading file...</p>';
    updateStatus('⏳ Loading and parsing file, please wait...');

    // Brief timeout allows the browser UI to paint the loading text before parsing freezes the thread
    await new Promise(r => setTimeout(r, 50));

    try {
        if (file.type === 'text/plain') {
            const text = await file.text();
            displayText(text);
            updateStatus('✅ Text loaded. Ready to play.');
        } else if (file.type === 'application/pdf') {
            await extractPdfText(file);
            updateStatus('✅ PDF loaded. Ready to play.');
        } else {
            contentDiv.innerHTML = '<p>Unsupported file type. Please upload a .txt or .pdf</p>';
            updateStatus('❌ Unsupported file type.');
        }
    } catch (error) {
        contentDiv.innerHTML = `<p>Error loading file: ${error.message}</p>`;
        updateStatus('❌ Error loading file.');
    }
});

// Format and inject text continuously
function displayText(text) {
    contentDiv.innerHTML = '';

    // Split by newlines to maintain basic document structure
    const paragraphs = text.split(/\r?\n/).filter(p => p.trim() !== '');
    
    paragraphs.forEach(p => {
        const pEl = document.createElement('p');
        pEl.textContent = p;
        contentDiv.appendChild(pEl);
    });
    
    updateSpeechChunks();
    currentChunkIndex = 0;
    updateProgressUI();
}

function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateSpeechChunks() {
    const textToSpeak = contentDiv.innerText;
    if (!textToSpeak || textToSpeak === 'Loading file...') {
        speechChunks = [];
        return;
    }
    speechChunks = textToSpeak.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [textToSpeak];
}

function updateProgressUI() {
    if (!speechChunks.length) return;
    let totalChars = speechChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    let elapsedChars = speechChunks.slice(0, currentChunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    
    timeTotal.textContent = formatTime(totalChars / CHARS_PER_SEC);
    timeCurrent.textContent = formatTime(elapsedChars / CHARS_PER_SEC);
    if (totalChars > 0) {
        progressBar.value = (elapsedChars / totalChars) * 100;
    }
}

// PDF Extraction Logic
async function extractPdfText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // Join the text items with spaces
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
    }
    displayText(fullText);
}

// Speech Synthesis Setup
let currentChunkIndex = 0;
let speechChunks = [];
let isStopped = false;

function speakNextChunk() {
    // Stop recursion if stopped by user or end of document reached
    if (isStopped || currentChunkIndex >= speechChunks.length) {
        isStopped = true;
        return;
    }
    
    const chunk = speechChunks[currentChunkIndex].trim();
    if (!chunk) {
        currentChunkIndex++;
        speakNextChunk();
        return;
    }

    updateProgressUI();

    const pageLang = document.documentElement.lang || navigator.language;
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = pageLang;
    
    // Strict Voice Locking: Stops Chrome from switching to English mid-sentence
    if (availableVoices.length === 0) {
        availableVoices = window.speechSynthesis.getVoices();
    }
    if (availableVoices.length > 0) {
        const targetLangPrefix = pageLang.toLowerCase().split('-')[0];
        const matchedVoice = availableVoices.find(v => v.lang.toLowerCase() === pageLang.toLowerCase()) 
                          || availableVoices.find(v => v.lang.toLowerCase().startsWith(targetLangPrefix));
        if (matchedVoice) {
            utterance.voice = matchedVoice;
        }
    }
    
    // Update progress bar smoothly word-by-word as the browser reads
    utterance.onboundary = (e) => {
        if (e.name === 'word') {
            if (!speechChunks.length) return;
            let totalChars = speechChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            let elapsedChars = speechChunks.slice(0, currentChunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
            
            elapsedChars += e.charIndex; // Add characters spoken in the current sentence
            
            timeCurrent.textContent = formatTime(elapsedChars / CHARS_PER_SEC);
            if (totalChars > 0) {
                progressBar.value = (elapsedChars / totalChars) * 100;
            }
        }
    };

    // Chain the next sentence to fire only when this one finishes
    utterance.onstart = () => {
        if (!isStopped) updateStatus('🔊 Playing...');
    };

    utterance.onend = () => {
        currentChunkIndex++;
        speakNextChunk();
    };

    utterance.onerror = (e) => {
        console.error("Speech error:", e);
        currentChunkIndex++;
        speakNextChunk(); // Keep going even if a chunk fails
    };
    
    window.speechSynthesis.speak(utterance);
}

async function speakContent(startIndex = 0) {
    isStopped = true;
    window.speechSynthesis.resume(); // Clear any stuck paused state
    window.speechSynthesis.cancel(); 

    updateStatus('⏳ Buffering speech...');

    // Yield thread to allow the browser to paint the visual loader before parsing large text
    await new Promise(r => setTimeout(r, 50));

    updateSpeechChunks();
    if (speechChunks.length === 0) return;
    
    currentChunkIndex = startIndex;
    isStopped = false;
    updateProgressUI();
    
    setTimeout(() => {
        if (!isStopped) speakNextChunk();
    }, 100);
}

// Control Buttons
btnPlay.addEventListener('click', () => {
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        updateStatus('🔊 Playing...');
    } else if (!window.speechSynthesis.speaking || isStopped) {
        speakContent(0);
    }
});

btnPause.addEventListener('click', () => {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        updateStatus('⏸ Paused');
    }
});

btnStop.addEventListener('click', () => {
    isStopped = true;
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    updateStatus('⏹ Stopped');
});

function skipSeconds(seconds) {
    if (!speechChunks.length) return;
    let elapsedChars = speechChunks.slice(0, currentChunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    const targetChars = elapsedChars + (seconds * CHARS_PER_SEC);
    
    let accumulated = 0;
    let targetIndex = 0;
    for (let i = 0; i < speechChunks.length; i++) {
        accumulated += speechChunks[i].length;
        if (accumulated >= targetChars) {
            targetIndex = i;
            break;
        }
    }
    if (targetChars < 0) targetIndex = 0;
    if (targetIndex >= speechChunks.length) targetIndex = speechChunks.length - 1;
    
    speakContent(targetIndex);
}

btnRev10.addEventListener('click', () => skipSeconds(-10));
btnFwd10.addEventListener('click', () => skipSeconds(10));

// --- Recording Logic ---
let mediaRecorder;
let recordedChunks = [];
let captureStream;
let isRecording = false;

btnRecord.addEventListener('click', async () => {
    if (!isRecording) {
        try {
            // Request to capture the current tab (requires user to select the tab and check "Share audio")
            captureStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "browser" }, // Video track is required by browsers to initiate tab capture
                audio: true
            });

            const audioTracks = captureStream.getAudioTracks();
            if (audioTracks.length === 0) {
                alert("No audio track found. Please make sure to toggle 'Share tab audio' in the prompt.");
                captureStream.getTracks().forEach(t => t.stop());
                return;
            }

            // Create a new stream with ONLY the audio track for MediaRecorder
            const audioStream = new MediaStream(audioTracks);
            mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });

            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const link = document.createElement('a');
                link.href = audioUrl;
                link.download = 'docureader_audio.webm';
                link.click();
                URL.revokeObjectURL(audioUrl);
                recordedChunks = [];
                updateStatus('✅ Recording saved');
                
                // Stop all original capture tracks (including video) to remove the browser's sharing indicator
                captureStream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            isRecording = true;
            btnRecord.textContent = '⏹ Stop Rec';
            updateStatus('🔴 Recording audio...');
            
            // Stop recording if the user clicks "Stop sharing" on the browser's native UI
            captureStream.getVideoTracks()[0].onended = () => {
                if (isRecording) stopRecording();
            };

        } catch (err) {
            console.error("Recording failed:", err);
            updateStatus('❌ Recording cancelled');
        }
    } else {
        stopRecording();
    }
});

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    isRecording = false;
    btnRecord.textContent = '🔴 Record';
}

progressBar.addEventListener('change', (e) => {
    if (!speechChunks.length) return;
    const percent = parseFloat(e.target.value);
    let totalChars = speechChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    let targetChars = totalChars * (percent / 100);
    
    let accumulated = 0;
    let targetIndex = 0;
    for (let i = 0; i < speechChunks.length; i++) {
        accumulated += speechChunks[i].length;
        if (accumulated >= targetChars) {
            targetIndex = i;
            break;
        }
    }
    speakContent(targetIndex);
});

// --- Long Press / Context Menu Logic ---
const popupMenu = document.getElementById('popupMenu');
let activeTarget = null;
let holdTimer = null;
let touchStartX = 0;
let touchStartY = 0;

function showPopup(x, y, target) {
    activeTarget = target;
    popupMenu.style.display = 'block';
    popupMenu.style.left = x + 'px';
    popupMenu.style.top = y + 'px';
    window.getSelection().removeAllRanges(); // Clears selection to dismiss native mobile menus
}

contentDiv.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || isEditMode) return;
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    activeTarget = e.target;

    // Trigger popup after a 600ms hold
    holdTimer = setTimeout(() => {
        showPopup(e.pageX, e.pageY, activeTarget);
    }, 600);
});

contentDiv.addEventListener('pointermove', (e) => {
    if (holdTimer) {
        const dx = e.clientX - touchStartX;
        const dy = e.clientY - touchStartY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }
});

const cancelHold = () => {
    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }
};

contentDiv.addEventListener('pointerup', cancelHold);
contentDiv.addEventListener('pointercancel', cancelHold);

// Right-click behavior on Desktop
contentDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancelHold();
    showPopup(e.pageX, e.pageY, e.target);
});

// Hide popup when clicking elsewhere on the page
document.addEventListener('pointerdown', (e) => {
    if (e.target !== popupMenu && !popupMenu.contains(e.target)) {
        popupMenu.style.display = 'none';
    }
});

// Play from specific paragraph
popupMenu.addEventListener('click', () => {
    popupMenu.style.display = 'none';
    if (!activeTarget) return;

    const textToSpeak = contentDiv.innerText;
    if (!textToSpeak || textToSpeak === 'Loading file...') return;

    let targetText = '';
    const selection = window.getSelection().toString().trim();
    
    if (selection) {
        targetText = selection;
    } else {
        const el = activeTarget.nodeType === 3 ? activeTarget.parentElement : activeTarget;
        const pEl = el.closest('p');
        targetText = pEl ? pEl.innerText : el.innerText;
    }

    const offset = textToSpeak.indexOf(targetText);
    let startIndex = 0;

    if (offset !== -1) {
        updateSpeechChunks();
        let runningLength = 0;
        for (let i = 0; i < speechChunks.length; i++) {
            runningLength += speechChunks[i].length;
            if (runningLength > offset) {
                startIndex = i;
                break;
            }
        }
    }
    
    speakContent(startIndex);
    window.getSelection().removeAllRanges();
});
