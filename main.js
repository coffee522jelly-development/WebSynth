document.addEventListener('DOMContentLoaded', () => {
    console.log('Synthesizer loaded');

    // Audio Context
    let audioContext;
    let masterGain;
    const activeNotesMap = new Map(); // Stores { oscillator, noteGain } by MIDI note number
    let envelope; // ADSR values from UI
    let filterNode; // BiquadFilterNode
    let lfoOscillator;
    let lfoGain;
    let currentLfoTarget = '';

    let waveformCanvas, waveformCtx; // For waveform display

    // --- Initialize Audio Context and Master Gain ---
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioContext.createGain();
            masterGain.connect(audioContext.destination);
            console.log('AudioContext initialized.');
        } catch (e) {
            alert('Web Audio API is not supported in this browser');
            console.error('Error initializing AudioContext:', e);
            return;
        }

        // Set initial master volume
        const volumeControl = document.getElementById('master-volume');
        masterGain.gain.setValueAtTime(parseFloat(volumeControl.value), audioContext.currentTime);
        volumeControl.addEventListener('input', (e) => {
            if (masterGain) {
                masterGain.gain.setValueAtTime(parseFloat(e.target.value), audioContext.currentTime);
            }
        });

        // Initialize other modules (placeholders for now)
        setupOscillator();
        setupEnvelope();
        setupFilter();
        setupLFO();
        setupKeyboard();

        console.log('Synthesizer setup complete.');
    }

    // --- Oscillator ---
    function setupOscillator() {
        const waveformRadios = document.querySelectorAll('input[name="waveform"]');
        let currentGlobalWaveform = 'sine'; // Default for new notes and UI

        waveformCanvas = document.getElementById('waveform-canvas');
        if (waveformCanvas) {
            waveformCtx = waveformCanvas.getContext('2d');
        } else {
            console.error("Waveform canvas not found!");
        }

        waveformRadios.forEach(radio => {
            if (radio.checked) {
                currentGlobalWaveform = radio.value;
            }
            radio.addEventListener('change', (e) => {
                currentGlobalWaveform = e.target.value;
                console.log('Global waveform changed to:', currentGlobalWaveform);
                if (waveformCtx && waveformCanvas) {
                    drawWaveform(waveformCtx, currentGlobalWaveform, waveformCanvas.width, waveformCanvas.height);
                }
                // Note: This does not change waveform for already playing notes.
                // window.getCurrentWaveform() will provide this new global type for new notes.
            });
        });

        // Store the function to get current waveform for later use
        window.getCurrentWaveform = () => currentGlobalWaveform;

        // Initial draw
        if (waveformCtx && waveformCanvas) {
            drawWaveform(waveformCtx, currentGlobalWaveform, waveformCanvas.width, waveformCanvas.height);
        }
        console.log('Oscillator UI setup complete. Initial waveform:', currentGlobalWaveform);
    }


    function drawWaveform(ctx, waveformType, width, height) {
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = '#FFA500'; // Orange theme color
        ctx.lineWidth = 2;
        ctx.beginPath();

        const amplitude = height / 2 * 0.8; // 80% of half height
        const centerY = height / 2;
        const cycles = 2; // Number of full waveform cycles to display
        const period = width / cycles;

        switch (waveformType) {
            case 'sine':
                ctx.moveTo(0, centerY);
                for (let x = 0; x <= width; x++) {
                    // (x / period) gives current position within a cycle (0 to cycles)
                    // Multiply by 2*PI for radians
                    const angle = (x / period) * (Math.PI * 2);
                    const y = centerY - amplitude * Math.sin(angle);
                    ctx.lineTo(x, y);
                }
                break;
            case 'square':
                for (let c = 0; c < cycles; c++) {
                    const startX = c * period;
                    ctx.moveTo(startX, centerY - amplitude);
                    ctx.lineTo(startX + period / 2, centerY - amplitude);
                    ctx.lineTo(startX + period / 2, centerY + amplitude);
                    ctx.lineTo(startX + period, centerY + amplitude);
                    // Draw vertical line back up for next cycle if not the last point
                    if (c < cycles -1 || startX + period < width -1) { // Check to avoid drawing past width
                         ctx.lineTo(startX + period, centerY - amplitude);
                    }
                }
                 // Ensure the line reaches the end if it's slightly off due to rounding
                if (width % period !== 0 && cycles * period < width) {
                    const lastX = cycles * period;
                    const lastY = ctx.currentPoint ? ctx.currentPoint.y : (waveformType === 'square' ? centerY + amplitude : centerY); // Get last Y
                    ctx.lineTo(width, lastY);
                }
                break;
            case 'sawtooth': // Rising sawtooth
                for (let c = 0; c < cycles; c++) {
                    const startX = c * period;
                    ctx.moveTo(startX, centerY + amplitude); // Start at bottom
                    ctx.lineTo(startX + period, centerY - amplitude); // Go to top
                     // Draw vertical line back down for next cycle if not the last point and not past width
                    if (c < cycles - 1 && (startX + period) < width -1 ) {
                         ctx.lineTo(startX + period, centerY + amplitude);
                    }
                }
                 if (width % period !== 0 && cycles * period < width) { // Ensure line reaches end
                    ctx.lineTo(width, centerY-amplitude); // complete the last ramp
                }
                break;
            case 'triangle':
                for (let c = 0; c < cycles; c++) {
                    const startX = c * period;
                    ctx.moveTo(startX, centerY);
                    ctx.lineTo(startX + period / 4, centerY - amplitude); // Up to peak
                    ctx.lineTo(startX + (period * 3) / 4, centerY + amplitude); // Down to trough
                    ctx.lineTo(startX + period, centerY); // Back to center
                }
                break;
            default:
                console.warn("Unknown waveform type for drawing:", waveformType);
        }
        ctx.stroke();
    }

    // --- Envelope (ADSR) ---
    function setupEnvelope() {
        envelope = {
            attack: parseFloat(document.getElementById('attack').value),
            decay: parseFloat(document.getElementById('decay').value),
            sustain: parseFloat(document.getElementById('sustain').value),
            release: parseFloat(document.getElementById('release').value)
        };

        document.getElementById('attack').addEventListener('input', (e) => envelope.attack = parseFloat(e.target.value));
        document.getElementById('decay').addEventListener('input', (e) => envelope.decay = parseFloat(e.target.value));
        document.getElementById('sustain').addEventListener('input', (e) => envelope.sustain = parseFloat(e.target.value));
        document.getElementById('release').addEventListener('input', (e) => envelope.release = parseFloat(e.target.value));
        console.log('Envelope setup complete. Initial values:', envelope);
    }

    // --- Filter ---
    function setupFilter() {
        // Initialize filterNode but it's not connected in the main audio chain for this task.
        // Its parameters are controlled by the UI.
        filterNode = audioContext.createBiquadFilter();
        filterNode.type = document.getElementById('filter-type').value;
        filterNode.frequency.setValueAtTime(parseFloat(document.getElementById('filter-frequency').value), audioContext.currentTime);
        filterNode.Q.setValueAtTime(parseFloat(document.getElementById('filter-q').value), audioContext.currentTime);

        document.getElementById('filter-type').addEventListener('change', (e) => {
            if (filterNode) filterNode.type = e.target.value;
        });
        document.getElementById('filter-frequency').addEventListener('input', (e) => {
            if (filterNode) filterNode.frequency.setValueAtTime(parseFloat(e.target.value), audioContext.currentTime);
        });
        document.getElementById('filter-q').addEventListener('input', (e) => {
            if (filterNode) filterNode.Q.setValueAtTime(parseFloat(e.target.value), audioContext.currentTime);
        });
        console.log('Filter UI setup complete. Initial type:', filterNode.type);
    }

    // --- LFO ---
    function setupLFO() {
        if (!audioContext) return; // AudioContext must be initialized

        lfoOscillator = audioContext.createOscillator();
        lfoGain = audioContext.createGain();

        const lfoFreqControl = document.getElementById('lfo-frequency');
        const lfoDepthControl = document.getElementById('lfo-depth');
        const lfoTargetControl = document.getElementById('lfo-target');

        lfoOscillator.frequency.setValueAtTime(parseFloat(lfoFreqControl.value), audioContext.currentTime);
        lfoGain.gain.setValueAtTime(parseFloat(lfoDepthControl.value), audioContext.currentTime);

        lfoOscillator.connect(lfoGain);
        lfoOscillator.start();

        currentLfoTarget = lfoTargetControl.value;
        updateLfoConnection();

        lfoFreqControl.addEventListener('input', (e) => {
            if (lfoOscillator) lfoOscillator.frequency.setValueAtTime(parseFloat(e.target.value), audioContext.currentTime);
        });
        lfoDepthControl.addEventListener('input', (e) => {
            if (lfoGain) lfoGain.gain.setValueAtTime(parseFloat(e.target.value), audioContext.currentTime);
        });
        lfoTargetControl.addEventListener('change', (e) => {
            currentLfoTarget = e.target.value;
            updateLfoConnection();
        });
        console.log('LFO setup complete.');
    }

    function updateLfoConnection() {
        if (!lfoGain || !audioContext) return;

        // Disconnect from all previous targets
        try {
            lfoGain.disconnect(); // Disconnects all outgoing connections
        } catch (e) {
            // This can throw if not connected to anything, which is fine.
        }


        if (currentLfoTarget === 'volume' && masterGain) {
            lfoGain.connect(masterGain.gain);
            console.log('LFO connected to masterGain.gain');
        } else if (currentLfoTarget === 'filter-frequency' && filterNode) {
            lfoGain.connect(filterNode.frequency);
            console.log('LFO connected to filterNode.frequency');
        } else {
            console.log('LFO not connected to any target or target not ready.');
        }
    }

    // --- Keyboard ---
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    function midiToFrequency(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function createKeyboard(octaves = 2, startingOctave = 3) {
        const keyboardPanel = document.getElementById('keyboard-panel');
        if (!keyboardPanel) {
            console.error('Keyboard panel not found');
            return;
        }
        keyboardPanel.innerHTML = ''; // Clear existing content

        // MIDI note for C4 is 60.
        // If startingOctave = 3, C3 is MIDI note 48.
        // If startingOctave = 4, C4 is MIDI note 60.
        const baseMidiNote = (startingOctave * 12); // C0=0, C1=12, ... C4=48. To make C4=60, startOctave=5? No, use fixed C4=60.
                                                    // Let's make startingOctave refer to the common notation. C4 is middle C.
                                                    // So, if startingOctave = 3, first note is C3. MIDI for C3 = (3*12) = 36. (This is low, C0 standard is often 12 or 24)
                                                    // Standard MIDI: C0=12, C1=24, C2=36, C3=48, C4=60.
                                                    // So midiNote = (octave * 12) + noteNames.indexOf(note) + 12 (for C0=12)

        let isMouseDown = false;
        window.addEventListener('mousedown', () => isMouseDown = true);
        window.addEventListener('mouseup', () => isMouseDown = false);


        for (let oct = 0; oct < octaves; oct++) {
            for (let i = 0; i < noteNames.length; i++) {
                const currentOctave = startingOctave + oct;
                const noteName = noteNames[i];
                // Standard MIDI: C4 = 60. Octave 0 is the first octave.
                // MIDI_NOTE = (octave_number * 12) + note_index_within_octave
                // For C4=60, if C is index 0, then octave 4: 4*12 = 48. This needs a +12 offset.
                // Or, consider "octave 1" as the first one in calculation.
                // Let's use: (octave + 1) * 12 + note_index for MIDI note calculation to align C4=60 with octave=4
                // Example: C4 (octave=4, index=0) => (4+1)*12 + 0 = 60.  This is if we consider octave 0 as -1 conceptually.
                // Simpler: C4 = 60.  C is index 0.
                // midiNote = (currentOctave * 12) + i; // This makes C0=0, C1=12, ..., C4=48.
                // To make C4=60, we need to add 12. So, midiNote = (currentOctave * 12) + i + 12 (assuming currentOctave starts from 0 for C0)
                // If `startingOctave` is 3 (meaning C3), then `currentOctave` values are 3, 4.
                // C3 (noteName='C', i=0, currentOctave=3): midiNote = (3*12)+0 = 36. (This is fine, C3=36, C#3=37 ... B3=47, C4=48)
                // This is the Roland standard where C4=48. Yamaha C4=60. Let's use C4=60 (Yamaha/DAW standard).
                // So, if currentOctave is 4 for C4, then midiNote = 4*12 + i + 12. (No, this is (octave_number_from_0_for_C0 * 12) + 12 + i)
                // Let's use Yamaha C4=60: midiNote = (currentOctave * 12) + i. Where C4 is octave 5.
                // Or, use the formula: (octave * 12) + note_index_from_C + Constant.
                // C4 = 60. (octave=4, C=0).  So, 4*12 + 0 + X = 60 => X = 12.
                // So, midiNote = currentOctaveInStandardNotation * 12 + noteIndexWithinOctave + 12 (where C is 0 index)
                // If my `currentOctave` variable represents standard notation (e.g. 3 for C3, 4 for C4)
                const midiNote = (currentOctave * 12) + i; // This makes C0=0, C1=12, C2=24, C3=36, C4=48, C5=60. Let's use C5=60.
                                                        // If we want C4=60, then midiNote = ( (currentOctave-4)*12 + 60 ) + i. (No, this is not right)
                                                        // midiNote = (currentOctave * 12 + i) + (60 - (4*12+0) ) = (currentOctave * 12 + i) + 12
                                                        // Assuming currentOctave means the number like in C3, C4.
                                                        // For C4 (octave 4, note C (index 0)), midiNote = 4*12 + 0 + 12 = 60. Correct.
                                                        // For C3 (octave 3, note C (index 0)), midiNote = 3*12 + 0 + 12 = 48. Correct.


                const key = document.createElement('div');
                key.classList.add('key');
                key.dataset.midiNote = midiNote;
                key.dataset.noteName = noteName;
                key.dataset.octave = currentOctave;
                key.textContent = `${noteName}${currentOctave}`; // Simple text content

                if (noteName.includes('#')) {
                    key.classList.add('black-key');
                } else {
                    key.classList.add('white-key');
                }

                key.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Prevent text selection, etc.
                    const freq = midiToFrequency(midiNote);
                    playNote(freq, midiNote);
                    key.classList.add('active');
                });

                key.addEventListener('mouseup', () => {
                    stopNote(midiNote);
                    key.classList.remove('active');
                });

                key.addEventListener('mouseleave', () => {
                    if (isMouseDown && key.classList.contains('active')) { // Only stop if mouse was down (dragging out)
                       stopNote(midiNote);
                       key.classList.remove('active');
                    }
                });
                 key.addEventListener('mouseenter', (e) => { // For dragging into a key
                    if (isMouseDown && !activeNotesMap.has(midiNote)) { // Only play if mouse is down and note isn't already playing
                        const freq = midiToFrequency(midiNote);
                        playNote(freq, midiNote);
                        key.classList.add('active');
                    }
                });


                keyboardPanel.appendChild(key);
            }
        }
        console.log(`Keyboard created: ${octaves} octaves, starting from octave ${startingOctave}`);
    }

    // Call createKeyboard after DOM is ready and audio context is potentially set up (or can be called in initAudio)
    // For now, ensure it's called after the panel exists.
    // setupKeyboard will now call createKeyboard
    function setupKeyboard() {
        createKeyboard(2, 3); // Create 2 octaves starting from octave 3 (C3)
        console.log('Keyboard setup complete.');
    }


    // --- Note Play Logic (Polyphonic with Envelope and Filter) ---
    function playNote(frequency, midiNote) { // Added midiNote parameter
        if (!audioContext || !filterNode) {
            console.warn("AudioContext or filterNode not initialized. Cannot play note.");
            return;
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => console.log("AudioContext resumed by playNote"));
        }

        // If note is already playing, stop it first (re-trigger)
        if (activeNotesMap.has(midiNote)) {
            const existingNote = activeNotesMap.get(midiNote);
            if (existingNote.oscillator) existingNote.oscillator.stop(audioContext.currentTime);
            if (existingNote.noteGain) existingNote.noteGain.disconnect();
            if (existingNote.oscillator) existingNote.oscillator.disconnect();
            activeNotesMap.delete(midiNote);
        }

        const now = audioContext.currentTime;
        const newOsc = audioContext.createOscillator();
        const newNoteGain = audioContext.createGain();

        newOsc.type = window.getCurrentWaveform();
        newOsc.frequency.setValueAtTime(frequency, now);

        // Audio Chain: oscillator -> noteGain -> filterNode (-> masterGain is global)
        newOsc.connect(newNoteGain);
        newNoteGain.connect(filterNode);
        // filterNode is connected to masterGain once globally after init.

        // ADSR Envelope
        newNoteGain.gain.cancelScheduledValues(now);
        newNoteGain.gain.setValueAtTime(0.0001, now); // Start from near zero
        newNoteGain.gain.linearRampToValueAtTime(1.0, now + Math.max(0.01, envelope.attack));
        newNoteGain.gain.linearRampToValueAtTime(envelope.sustain, now + Math.max(0.01, envelope.attack) + Math.max(0.01, envelope.decay));

        newOsc.start(now);
        activeNotesMap.set(midiNote, { oscillator: newOsc, noteGain: newNoteGain });

        console.log(`Playing MIDI ${midiNote} (${frequency.toFixed(2)}Hz). ADSR: A:${envelope.attack} D:${envelope.decay} S:${envelope.sustain}. Active notes: ${activeNotesMap.size}`);
    }

    function stopNote(midiNote) { // Added midiNote parameter
        const noteToEnd = activeNotesMap.get(midiNote);
        if (!noteToEnd || !noteToEnd.noteGain) {
            // console.log(`Note ${midiNote} not found or already stopped.`);
            return;
        }

        const now = audioContext.currentTime;
        const currentGainValue = noteToEnd.noteGain.gain.value;

        noteToEnd.noteGain.gain.cancelScheduledValues(now);
        noteToEnd.noteGain.gain.setValueAtTime(currentGainValue, now); // Hold current gain
        const releaseEndTime = now + Math.max(0.01, envelope.release);
        noteToEnd.noteGain.gain.linearRampToValueAtTime(0.0001, releaseEndTime);

        if (noteToEnd.oscillator) {
            noteToEnd.oscillator.stop(releaseEndTime);
        }

        // Cleanup after release
        setTimeout(() => {
            if (noteToEnd.noteGain) noteToEnd.noteGain.disconnect();
            if (noteToEnd.oscillator) noteToEnd.oscillator.disconnect();
            // Check if the note is still the one we intended to remove, in case of rapid re-trigger
            if (activeNotesMap.get(midiNote) === noteToEnd) {
                 activeNotesMap.delete(midiNote);
            }
            console.log(`MIDI ${midiNote} stopped. Active notes: ${activeNotesMap.size}`);
        }, (releaseEndTime - now + 0.2) * 1000); // Slightly longer timeout for safety

        // No immediate removal from map, let timeout handle it to allow release phase to complete.
        // If a key is re-pressed quickly, playNote will handle stopping the old one.
        console.log(`Stopping MIDI ${midiNote}. Release: ${envelope.release}`);
    }

    // Remove 'p' key test code
    /*
    window.addEventListener('keydown', (e) => {
        if (e.key === 'p' && !window.isPKeyDown) {
            window.isPKeyDown = true;
            console.log("Key 'p' pressed - playing note.");
            playNote(261.63, 60); // Assuming C4 = MIDI 60 for test
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === 'p') {
            window.isPKeyDown = false;
            console.log("Key 'p' released - stopping note.");
            stopNote(60); // Assuming C4 = MIDI 60 for test
        }
    });
    */

    // Initialize Audio on a user gesture (e.g., a button click)
    // For now, let's try to initialize it directly, but be aware of browser autoplay policies.
    // A better approach is a "Start" button.
    const startButton = document.createElement('button');
    startButton.textContent = 'Start Synthesizer';
    startButton.style.position = 'absolute';
    startButton.style.top = '5px';
    startButton.style.left = '5px';
    startButton.style.zIndex = '100';

    startButton.addEventListener('click', () => {
        if (!audioContext) {
            initAudio();
            // Establish filterNode -> masterGain connection once globally.
            if (filterNode && masterGain) {
                filterNode.connect(masterGain);
                console.log('Global connection: filterNode -> masterGain established.');
            } else {
                console.error('filterNode or masterGain not ready for global connection.');
            }
            setupMidi(); // Setup MIDI after audio context and main connections are ready.
        } else if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed.');
                // It's good practice to ensure MIDI is still good or re-init if necessary,
                // but for now, just resuming context. setupMidi() might need to be more robust
                // to handle being called multiple times or checking existing state.
            });
        }
        startButton.style.display = 'none';
        console.log('Synthesizer started/resumed by user gesture.');
    }, { once: true });

    document.body.appendChild(startButton);

    // If AudioContext can start without user gesture (some browsers allow this from localhost)
    // initAudio(); // Commented out to prefer user gesture start

    // --- MIDI Setup ---
    function setupMidi() {
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess()
                .then(onMIDISuccess, onMIDIFailure);
        } else {
            console.warn("Web MIDI API is not supported in this browser.");
        }
    }

    function onMIDISuccess(midiAccess) {
        console.log("MIDI Access Granted!");
        const inputs = midiAccess.inputs.values();
        for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
            if(input.value) { // Check if input.value is not null or undefined
                console.log(`Found MIDI input: ${input.value.name} (ID: ${input.value.id}, State: ${input.value.state}, Type: ${input.value.type})`);
                input.value.onmidimessage = handleMidiMessage;
            }
        }

        midiAccess.onstatechange = (event) => {
            console.log(`MIDI state changed: ${event.port.name}, state: ${event.port.state}, type: ${event.port.type}`);
            if (event.port.type === "input" && event.port.state === "connected" && event.port.connection !== "closed") {
                 // Check connection state as well, sometimes "connected" is fired before it's truly open.
                console.log(`New MIDI input connected: ${event.port.name}. Attaching listener.`);
                event.port.onmidimessage = handleMidiMessage;
            } else if (event.port.type === "input" && event.port.state === "disconnected") {
                console.log(`MIDI input disconnected: ${event.port.name}.`);
                // Optionally, remove the listener or handle UI updates.
                // event.port.onmidimessage = null; // This might not be necessary if the port object is destroyed.
            }
        };
    }

    function onMIDIFailure(msg) {
        console.error(`Failed to get MIDI access - ${msg}`);
    }

    function handleMidiMessage(event) {
        if (!event.data || event.data.length < 2) {
            console.warn("Received incomplete MIDI message:", event);
            return;
        }
        const command = event.data[0] & 0xF0; // Mask channel nibble (e.g., 0x90, 0x80)
        const note = event.data[1];      // MIDI note number (0-127)
        const velocity = event.data.length > 2 ? event.data[2] : 0; // Velocity (0-127)

        // console.log(`MIDI Raw: Command ${event.data[0].toString(16)}, Note ${note}, Velocity ${velocity}`);

        switch (command) {
            case 0x90: // Note On
                if (velocity > 0) {
                    // console.log(`MIDI Note On: Note ${note}, Vel ${velocity}`);
                    const freq = midiToFrequency(note);
                    playNote(freq, note); // playNote now takes midiNote
                    updateKeyHighlight(note, true);
                } else {
                    // Note On with velocity 0 is often treated as Note Off
                    // console.log(`MIDI Note Off (via Vel 0): Note ${note}`);
                    stopNote(note); // stopNote now takes midiNote
                    updateKeyHighlight(note, false);
                }
                break;
            case 0x80: // Note Off
                // console.log(`MIDI Note Off: Note ${note}`);
                stopNote(note);
                updateKeyHighlight(note, false);
                break;
            // Other MIDI messages like pitch bend, CC can be handled here
        }
    }

    function updateKeyHighlight(midiNote, isActive) {
        const keyElement = document.querySelector(`.key[data-midi-note="${midiNote}"]`);
        if (keyElement) {
            if (isActive) {
                keyElement.classList.add('active');
            } else {
                keyElement.classList.remove('active');
            }
        }
    }
});
