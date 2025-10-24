/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import { throttle } from '../utils/throttle';

import './PromptController';
import './PlayPauseButton';
import type { PlaybackState, Prompt } from '../types';
import { MidiDispatcher } from '../utils/MidiDispatcher';

const PROMPT_ORDER_STORAGE_KEY = 'prompt-dj-midi-order';
const MASTER_VOLUME_STORAGE_KEY = 'prompt-dj-midi-volume';
const EQ_LOW_STORAGE_KEY = 'prompt-dj-midi-eq-low';
const EQ_MID_STORAGE_KEY = 'prompt-dj-midi-eq-mid';
const EQ_HIGH_STORAGE_KEY = 'prompt-dj-midi-eq-high';

/** The grid of prompt inputs. */
@customElement('prompt-dj-midi')
export class PromptDjMidi extends LitElement {
  static override styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
      position: relative;
      overflow-y: auto; /* Allow scrolling on small screens */
    }
    #background {
      will-change: background-image;
      position: absolute;
      height: 100%;
      width: 100%;
      z-index: -1;
      background: #111;
    }
    #controls {
      display: flex;
      flex-wrap: wrap;
      gap: 1vmin;
      justify-content: center;
      align-items: center;
      width: 100%;
      padding: 2vmin;
      box-sizing: border-box;
    }
    main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      width: 100%;
    }
    #grid {
      width: 80vmin;
      height: 80vmin;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2.5vmin;
    }
    #grid.organize-mode prompt-controller {
      cursor: grab;
    }
    prompt-controller {
      width: 100%;
      transition: transform 0.2s ease-in-out;
    }
    prompt-controller.dragging {
      opacity: 0.4;
      transform: scale(0.95);
    }
    play-pause-button {
      position: relative;
      width: 15vmin;
    }
    .midi-record-stack {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    button {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      background: #0002;
      -webkit-font-smoothing: antialiased;
      border: 1.5px solid #fff;
      border-radius: 4px;
      user-select: none;
      padding: 3px 6px;
      &.active {
        background-color: #fff;
        color: #000;
      }
    }
    button.recording {
      background-color: #da2000;
      color: #fff;
    }
    select {
      font: inherit;
      padding: 5px;
      background: #fff;
      color: #000;
      border-radius: 4px;
      border: none;
      outline: none;
      cursor: pointer;
    }
    #recording-container {
      margin-top: 2vmin;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1vmin;
      height: 10vmin;
    }
    #recording-container audio {
      max-width: 80%;
    }
    #recording-container button {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      background: #0002;
      -webkit-font-smoothing: antialiased;
      border: 1.5px solid #fff;
      border-radius: 4px;
      user-select: none;
      padding: 3px 6px;
    }
    #pitch-bend-container {
      display: flex;
      align-items: center;
      gap: 5px;
      color: white;
      margin-left: 10px;
      font-weight: 600;
    }
    #effects-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: #0002;
      border: 1.5px solid #fff;
      border-radius: 4px;
      padding: 4px;
      margin-left: 10px;
    }
    #eq-controls {
      color: white;
      font-weight: 600;
      font-size: 0.9em;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .control-band {
      display: grid;
      grid-template-columns: 3ch 1fr 4ch;
      align-items: center;
      gap: 5px;
    }
    .control-band span:first-of-type {
      text-align: right;
    }
    input[type=range] {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      cursor: pointer;
      width: 15vmin;
    }
    input[type=range]::-webkit-slider-runnable-track {
      background: #0002;
      border: 1.5px solid #fff;
      border-radius: 4px;
      height: 0.5rem;
    }
    input[type=range]::-moz-range-track {
      background: #0002;
      border: 1.5px solid #fff;
      border-radius: 4px;
      height: 0.5rem;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      margin-top: -6px;
      background-color: #fff;
      border-radius: 4px;
      height: 1rem;
      width: 0.5rem;
    }
    input[type=range]::-moz-range-thumb {
      border: none;
      border-radius: 4px;
      background-color: #fff;
      height: 1rem;
      width: 0.5rem;
    }
  `;

  private prompts: Map<string, Prompt>;
  private promptOrder: string[];
  private midiDispatcher: MidiDispatcher;

  @property({ type: Boolean }) private showMidi = false;
  @property({ type: String }) public playbackState: PlaybackState = 'stopped';
  @state() public audioLevel = 0;
  @state() private midiInputIds: string[] = [];
  @state() private activeMidiInputId: string | null = null;
  @state() private pitchBend = 0;

  @property({ type: Object })
  private filteredPrompts = new Set<string>();

  @state() private isRecording = false;
  @property({ type: String }) recordingUrl: string | null = null;
  
  @state() private organizeMode = false;
  private draggedPromptId: string | null = null;

  @state() private eqLow = 0;
  @state() private eqMid = 0;
  @state() private eqHigh = 0;
  @state() private masterVolume = 100;

  constructor(
    initialPrompts: Map<string, Prompt>,
  ) {
    super();
    this.prompts = initialPrompts;
    this.midiDispatcher = new MidiDispatcher();
    
    // Load prompt order from localStorage or initialize from prompts
    const savedOrder = localStorage.getItem(PROMPT_ORDER_STORAGE_KEY);
    if (savedOrder) {
      // Filter out any IDs that are no longer in the main prompts map
      const parsedOrder = JSON.parse(savedOrder);
      const validOrder = parsedOrder.filter((id: string) => this.prompts.has(id));
      // Add any new prompts that weren't in the saved order
      const currentIds = new Set(validOrder);
      for (const id of this.prompts.keys()) {
        if (!currentIds.has(id)) {
          validOrder.push(id);
        }
      }
      this.promptOrder = validOrder;
    } else {
      this.promptOrder = Array.from(this.prompts.keys());
    }
    this.savePromptOrder(); // Save the initial or cleaned-up order

    // Load effects settings from localStorage
    const savedVolume = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    this.masterVolume = savedVolume ? parseFloat(savedVolume) : 100;
    const savedEqLow = localStorage.getItem(EQ_LOW_STORAGE_KEY);
    this.eqLow = savedEqLow ? parseFloat(savedEqLow) : 0;
    const savedEqMid = localStorage.getItem(EQ_MID_STORAGE_KEY);
    this.eqMid = savedEqMid ? parseFloat(savedEqMid) : 0;
    const savedEqHigh = localStorage.getItem(EQ_HIGH_STORAGE_KEY);
    this.eqHigh = savedEqHigh ? parseFloat(savedEqHigh) : 0;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.midiDispatcher.addEventListener('pitch-bend-message', this.handleMidiPitchBend);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.midiDispatcher.removeEventListener('pitch-bend-message', this.handleMidiPitchBend);
  }

  override firstUpdated() {
    // Dispatch initial effects settings
    this.dispatchEqEvent();
    this.dispatchMasterVolumeEvent();
  }

  private savePromptOrder() {
    localStorage.setItem(PROMPT_ORDER_STORAGE_KEY, JSON.stringify(this.promptOrder));
  }

  private handleMidiPitchBend = (e: Event) => {
    const customEvent = e as CustomEvent<number>;
    this.pitchBend = customEvent.detail;
    this.dispatchPitchBendEvent();
  }

  private handlePromptChanged(e: CustomEvent<Prompt>) {
    const { promptId, text, weight, cc } = e.detail;
    const prompt = this.prompts.get(promptId);

    if (!prompt) {
      console.error('prompt not found', promptId);
      return;
    }

    prompt.text = text;
    prompt.weight = weight;
    prompt.cc = cc;

    const newPrompts = new Map(this.prompts);
    newPrompts.set(promptId, prompt);

    this.prompts = newPrompts;
    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent('prompts-changed', { detail: this.prompts }),
    );
  }

  /** Generates radial gradients for each prompt based on weight and color. */
  private readonly makeBackground = throttle(
    () => {
      const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

      const MAX_WEIGHT = 0.5;
      const MAX_ALPHA = 0.6;

      const bg: string[] = [];

      this.promptOrder.forEach((promptId, i) => {
        const p = this.prompts.get(promptId)!;
        const alphaPct = clamp01(p.weight / MAX_WEIGHT) * MAX_ALPHA;
        const alpha = Math.round(alphaPct * 0xff)
          .toString(16)
          .padStart(2, '0');

        const stop = p.weight / 2;
        const x = (i % 4) / 3;
        const y = Math.floor(i / 4) / 3;
        const s = `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${p.color}${alpha} 0px, ${p.color}00 ${stop * 100}%)`;

        bg.push(s);
      });

      return bg.join(', ');
    },
    30, // don't re-render more than once every XXms
  );

  private toggleShowMidi() {
    return this.setShowMidi(!this.showMidi);
  }

  public async setShowMidi(show: boolean) {
    this.showMidi = show;
    if (!this.showMidi) return;
    try {
      const inputIds = await this.midiDispatcher.getMidiAccess();
      this.midiInputIds = inputIds;
      this.activeMidiInputId = this.midiDispatcher.activeMidiInputId;
    } catch (e: any) {
      this.dispatchEvent(new CustomEvent('error', {detail: e.message}));
    }
  }

  private handleMidiInputChange(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const newMidiId = selectElement.value;
    this.activeMidiInputId = newMidiId;
    this.midiDispatcher.activeMidiInputId = newMidiId;
  }

  private playPause() {
    this.dispatchEvent(new CustomEvent('play-pause'));
  }

  public addFilteredPrompt(prompt: string) {
    this.filteredPrompts = new Set([...this.filteredPrompts, prompt]);
  }

  private toggleRecording() {
    this.isRecording = !this.isRecording;
    if (this.isRecording) {
      // Clear previous recording when starting a new one
      if (this.recordingUrl) {
        URL.revokeObjectURL(this.recordingUrl);
        this.recordingUrl = null;
      }
      this.dispatchEvent(new CustomEvent('start-recording'));
    } else {
      this.dispatchEvent(new CustomEvent('stop-recording'));
    }
  }

  private downloadRecording() {
    if (!this.recordingUrl) return;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = this.recordingUrl;
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
    a.download = `DJ-de-Prompt-gravacao_${timestamp}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  
  private handlePitchBendChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.pitchBend = parseFloat(target.value);
    this.dispatchPitchBendEvent();
  }

  private resetPitchBend() {
    this.pitchBend = 0;
    this.dispatchPitchBendEvent();
  }

  private dispatchPitchBendEvent() {
    this.dispatchEvent(new CustomEvent('pitch-bend-changed', { detail: this.pitchBend }));
  }

  private toggleOrganizeMode() {
    this.organizeMode = !this.organizeMode;
  }

  private handleDragStart(e: DragEvent, promptId: string) {
    if (!this.organizeMode || !(e.target instanceof HTMLElement)) return;
    this.draggedPromptId = promptId;
    e.dataTransfer!.setData('text/plain', promptId);
    e.dataTransfer!.effectAllowed = 'move';
    // FIX: Capture `e.target` in a variable to preserve its narrowed type within the `setTimeout` closure.
    const target = e.target;
    // Add class slightly later to allow the browser to capture the element's appearance before the change
    setTimeout(() => {
      target.classList.add('dragging');
    }, 0);
  }

  private handleDragOver(e: DragEvent) {
    if (!this.organizeMode) return;
    e.preventDefault(); // This is necessary to allow a drop.
    e.dataTransfer!.dropEffect = 'move';
  }

  private handleDrop(e: DragEvent, targetPromptId: string) {
    if (!this.organizeMode || !this.draggedPromptId) return;
    e.preventDefault();
    
    const draggedId = this.draggedPromptId;
    if (draggedId === targetPromptId) return;

    const newOrder = [...this.promptOrder];
    const draggedIndex = newOrder.indexOf(draggedId);
    const targetIndex = newOrder.indexOf(targetPromptId);

    // Remove the dragged item
    const [removedItem] = newOrder.splice(draggedIndex, 1);
    // Insert it at the target's position
    newOrder.splice(targetIndex, 0, removedItem);

    this.promptOrder = newOrder;
    this.savePromptOrder();
  }

  private handleDragEnd(e: DragEvent) {
    if (!this.organizeMode) return;
    this.draggedPromptId = null;
    // Find the element that was being dragged and remove the class
    const draggingEl = this.shadowRoot?.querySelector('.dragging');
    draggingEl?.classList.remove('dragging');
  }

  private handleEqChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const band = target.id.split('-')[1]; // 'low', 'mid', 'high'
    const value = parseFloat(target.value);

    switch(band) {
        case 'low': this.eqLow = value; localStorage.setItem(EQ_LOW_STORAGE_KEY, String(value)); break;
        case 'mid': this.eqMid = value; localStorage.setItem(EQ_MID_STORAGE_KEY, String(value)); break;
        case 'high': this.eqHigh = value; localStorage.setItem(EQ_HIGH_STORAGE_KEY, String(value)); break;
    }
    this.dispatchEqEvent();
  }

  private dispatchEqEvent() {
    this.dispatchEvent(new CustomEvent('eq-settings-changed', {
        detail: {
            low: this.eqLow,
            mid: this.eqMid,
            high: this.eqHigh,
        }
    }));
  }

  private handleMasterVolumeChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.masterVolume = parseFloat(target.value);
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, this.masterVolume.toString());
    this.dispatchMasterVolumeEvent();
  }

  private dispatchMasterVolumeEvent() {
    // slider is 0-100, gain node wants 0-1
    this.dispatchEvent(new CustomEvent('master-volume-changed', {
      detail: this.masterVolume / 100
    }));
  }

  override render() {
    const bg = styleMap({
      backgroundImage: this.makeBackground(),
    });
    const gridClasses = classMap({
      'organize-mode': this.organizeMode,
    });
    return html`<div id="background" style=${bg}></div>
      <div id="controls">
        <div class="midi-record-stack">
          <button
            @click=${this.toggleShowMidi}
            class=${this.showMidi ? 'active' : ''}
            >MIDI</button
          >
          <button
            @click=${this.toggleRecording}
            class=${this.isRecording ? 'recording' : ''}
            .disabled=${this.playbackState === 'stopped' || this.playbackState === 'loading'}>
            ${this.isRecording ? 'Parar Gravação' : 'Gravar'}
          </button>
        </div>
        <button @click=${this.toggleOrganizeMode} class=${this.organizeMode ? 'active' : ''}>
          ${this.organizeMode ? 'Concluir' : 'Organizar'}
        </button>
        <select
          @change=${this.handleMidiInputChange}
          .value=${this.activeMidiInputId || ''}
          style=${this.showMidi ? '' : 'visibility: hidden'}>
          ${this.midiInputIds.length > 0
        ? this.midiInputIds.map(
          (id) =>
            html`<option value=${id}>
                    ${this.midiDispatcher.getDeviceName(id)}
                  </option>`,
        )
        : html`<option value="">Nenhum dispositivo encontrado</option>`}
        </select>
        <div id="pitch-bend-container" style=${this.showMidi ? '' : 'visibility: hidden'}>
          <label for="pitch-bend">Pitch</label>
          <input
            type="range"
            id="pitch-bend"
            min="-1"
            max="1"
            step="0.01"
            .value=${this.pitchBend}
            @input=${this.handlePitchBendChange}
          />
          <button @click=${this.resetPitchBend}>Reset</button>
        </div>
        <div id="effects-container" style=${(this.playbackState !== 'stopped' && this.playbackState !== 'loading') ? '' : 'display: none'}>
          <div id="eq-controls">
            <div class="control-band">
              <span>Hi</span>
              <input type="range" id="eq-high" min="-24" max="24" step="1" .value=${this.eqHigh} @input=${this.handleEqChange}>
              <span>${this.eqHigh}</span>
            </div>
            <div class="control-band">
              <span>Mid</span>
              <input type="range" id="eq-mid" min="-24" max="24" step="1" .value=${this.eqMid} @input=${this.handleEqChange}>
              <span>${this.eqMid}</span>
            </div>
            <div class="control-band">
              <span>Low</span>
              <input type="range" id="eq-low" min="-24" max="24" step="1" .value=${this.eqLow} @input=${this.handleEqChange}>
              <span>${this.eqLow}</span>
            </div>
            <div class="control-band">
              <span>Vol</span>
              <input type="range" id="master-volume" min="0" max="100" step="1" .value=${this.masterVolume} @input=${this.handleMasterVolumeChange}>
              <span>${this.masterVolume}</span>
            </div>
          </div>
        </div>
      </div>
      <main>
        <div id="grid" class=${gridClasses}>${this.renderPrompts()}</div>
        <div id="recording-container">
          ${this.recordingUrl
            ? html`
                <audio controls src=${this.recordingUrl}></audio>
                <button @click=${this.downloadRecording}>Baixar Gravação</button>
              `
            : ''}
        </div>
        <play-pause-button .playbackState=${this.playbackState} @click=${this.playPause}></play-pause-button>
      </main>`;
  }

  private renderPrompts() {
    return this.promptOrder.map((promptId) => {
      const prompt = this.prompts.get(promptId)!;
      return html`<prompt-controller
        draggable=${this.organizeMode}
        @dragstart=${(e: DragEvent) => this.handleDragStart(e, prompt.promptId)}
        @dragover=${this.handleDragOver}
        @drop=${(e: DragEvent) => this.handleDrop(e, prompt.promptId)}
        @dragend=${this.handleDragEnd}
        promptId=${prompt.promptId}
        ?filtered=${this.filteredPrompts.has(prompt.text)}
        cc=${prompt.cc}
        text=${prompt.text}
        weight=${prompt.weight}
        color=${prompt.color}
        .midiDispatcher=${this.midiDispatcher}
        .showCC=${this.showMidi}
        audioLevel=${this.audioLevel}
        @prompt-changed=${this.handlePromptChanged}>
      </prompt-controller>`;
    });
  }
}