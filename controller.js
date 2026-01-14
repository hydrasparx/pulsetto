// Pulsetto Controller
class PulsettoController {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.writeCharacteristic = null;
        this.notifyCharacteristic = null;
        this.currentMode = 'D'; // Default to BOTH
        this.currentIntensity = 5;
        this.sessionActive = false;
        this.sessionStartTime = null;
        this.timerInterval = null;
        this.presets = this.loadPresets();

        // UUIDs from traffic analysis
        this.SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
        this.WRITE_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // RX on device (Write)
        this.NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // TX on device (Notify)

        this.initUI();
    }

    initUI() {
        // Connect button
        document.getElementById('connectBtn').addEventListener('click', () => this.connect());

        // Mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            if (btn.dataset.mode === this.currentMode) {
                btn.classList.add('active');
            }
            btn.addEventListener('click', (e) => {
                const mode = e.target.dataset.mode;
                this.setMode(mode);
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Intensity slider
        const slider = document.getElementById('intensitySlider');
        // Set default value
        slider.value = this.currentIntensity;
        const display = document.getElementById('intensityDisplay');
        display.textContent = this.currentIntensity;

        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            display.textContent = value;
            if (this.sessionActive) {
                this.setIntensity(value);
            }
        });

        // Session controls
        document.getElementById('startBtn').addEventListener('click', () => this.startSession());
        document.getElementById('stopBtn').addEventListener('click', () => this.stopSession());

        // Preset controls
        document.getElementById('addPresetBtn').addEventListener('click', () => this.showPresetModal());
        document.getElementById('savePresetBtn').addEventListener('click', () => this.savePreset());
        document.getElementById('cancelPresetBtn').addEventListener('click', () => this.hidePresetModal());

        this.renderPresets();
    }

    async connect() {
        try {
            console.log('Requesting Bluetooth Device...');
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Pulsetto' }],
                optionalServices: [this.SERVICE_UUID]
            });

            console.log('Connecting to GATT Server...');
            this.server = await this.device.gatt.connect();

            console.log('Getting Service...');
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);

            console.log('Getting Characteristics...');
            this.writeCharacteristic = await this.service.getCharacteristic(this.WRITE_UUID);
            this.notifyCharacteristic = await this.service.getCharacteristic(this.NOTIFY_UUID);

            // Start notifications
            await this.notifyCharacteristic.startNotifications();
            this.notifyCharacteristic.addEventListener('characteristicvaluechanged', (e) => this.handleNotification(e));

            console.log('Connected!');
            this.onConnected();
        } catch (error) {
            console.error('Connection failed:', error);
            alert('Failed to connect: ' + error.message);
        }
    }

    async onConnected() {
        document.getElementById('connectBtn').textContent = 'Connected ✓';
        document.getElementById('connectBtn').classList.remove('btn-primary');
        document.getElementById('connectBtn').classList.add('btn-success');
        document.getElementById('connectBtn').disabled = true;

        document.getElementById('deviceInfo').classList.remove('hidden');
        document.getElementById('controlCard').classList.remove('hidden');
        document.getElementById('presetsCard').classList.remove('hidden');

        // Query device info
        await this.sendCommand('i');
        await this.delay(100);
        await this.sendCommand('v');
        await this.delay(100);
        await this.sendCommand('Q');

        // Start status polling
        this.startStatusPolling();
    }

    async sendCommand(cmd) {
        if (!this.writeCharacteristic) return;

        const data = cmd + '\n';
        const encoder = new TextEncoder();
        const bytes = encoder.encode(data);

        console.log('Sending:', data.trim());
        await this.writeCharacteristic.writeValue(bytes);
    }

    handleNotification(event) {
        const decoder = new TextDecoder();
        const value = decoder.decode(event.target.value);
        console.log('Received:', value);

        // Parse responses
        if (value.startsWith('Pulsetto_')) {
            document.getElementById('deviceName').textContent = value.trim();
        } else if (value.startsWith('fw:')) {
            document.getElementById('firmware').textContent = value.trim();
        } else if (value.includes('Batt:')) {
            const voltage = value.split('Batt:')[1].trim();
            document.getElementById('battery').textContent = voltage + 'V';
        } else if (value.includes('mode:')) {
            const mode = value.split('mode:')[1].trim();
            const modeText = mode === '0' ? 'OFF' : mode === 'A' ? 'LEFT' : mode === 'C' ? 'RIGHT' : mode === 'D' ? 'BOTH' : mode;
            document.getElementById('mode').textContent = modeText;
        }
    }

    async setMode(mode) {
        this.currentMode = mode;
        await this.sendCommand(mode);
    }

    async setIntensity(level) {
        this.currentIntensity = level;
        await this.sendCommand(level.toString());
    }

    async startSession() {
        if (!this.currentMode) {
            alert('Please select a mode first');
            return;
        }

        this.sessionActive = true;
        this.sessionStartTime = Date.now();

        // Start with selected mode and intensity
        await this.setMode(this.currentMode);
        await this.delay(100);
        const intensity = parseInt(document.getElementById('intensitySlider').value);
        if (intensity > 0) {
            await this.setIntensity(intensity);
        }

        // Start timer
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);

        document.getElementById('startBtn').disabled = true;
    }

    async stopSession() {
        this.sessionActive = false;

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // End session
        await this.sendCommand('-');

        // Reset UI
        document.getElementById('timer').textContent = '00:00';
        document.getElementById('startBtn').disabled = false;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    }

    updateTimer() {
        if (!this.sessionStartTime) return;

        const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;

        document.getElementById('timer').textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    startStatusPolling() {
        setInterval(async () => {
            if (this.writeCharacteristic) {
                await this.sendCommand('Q');
            }
        }, 3000);
    }

    // Preset management
    loadPresets() {
        const saved = localStorage.getItem('pulsetto_presets');
        return saved ? JSON.parse(saved) : [];
    }

    savePresetsToStorage() {
        localStorage.setItem('pulsetto_presets', JSON.stringify(this.presets));
    }

    showPresetModal() {
        document.getElementById('presetModal').classList.remove('hidden');
    }

    hidePresetModal() {
        document.getElementById('presetModal').classList.add('hidden');
        document.getElementById('presetName').value = '';
    }

    savePreset() {
        const name = document.getElementById('presetName').value.trim();
        const mode = document.getElementById('presetMode').value;
        const intensity = parseInt(document.getElementById('presetIntensity').value);
        const duration = parseInt(document.getElementById('presetDuration').value);

        if (!name) {
            alert('Please enter a preset name');
            return;
        }

        this.presets.push({ name, mode, intensity, duration });
        this.savePresetsToStorage();
        this.renderPresets();
        this.hidePresetModal();
    }

    deletePreset(index) {
        if (confirm('Delete this preset?')) {
            this.presets.splice(index, 1);
            this.savePresetsToStorage();
            this.renderPresets();
        }
    }

    async loadPreset(preset) {
        // Set mode
        this.currentMode = preset.mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === preset.mode);
        });

        // Set intensity
        document.getElementById('intensitySlider').value = preset.intensity;
        document.getElementById('intensityDisplay').textContent = preset.intensity;

        // Start session
        await this.startSession();

        // Auto-stop after duration
        setTimeout(() => {
            this.stopSession();
        }, preset.duration * 60 * 1000);
    }

    renderPresets() {
        const list = document.getElementById('presetsList');
        if (this.presets.length === 0) {
            list.innerHTML = '<p style="opacity: 0.7; text-align: center;">No presets saved</p>';
            return;
        }

        list.innerHTML = this.presets.map((preset, index) => `
            <div class="preset-item">
                <div class="preset-info">
                    <div class="preset-name">${preset.name}</div>
                    <div class="preset-details">
                        ${preset.mode === 'A' ? 'LEFT' : preset.mode === 'C' ? 'RIGHT' : 'BOTH'} • 
                        Intensity ${preset.intensity} • 
                        ${preset.duration} min
                    </div>
                </div>
                <div class="preset-actions">
                    <button class="preset-btn" onclick="controller.loadPreset(controller.presets[${index}])">Load</button>
                    <button class="preset-btn" onclick="controller.deletePreset(${index})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize controller
const controller = new PulsettoController();
