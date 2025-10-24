/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { ControlChange } from '../types';

/** Simple class for dispatching MIDI CC messages as events. */
export class MidiDispatcher extends EventTarget {
  private access: MIDIAccess | null = null;
  activeMidiInputId: string | null = null;

  async getMidiAccess(): Promise<string[]> {

    if (this.access) {
      return [...this.access.inputs.keys()];
    }

    if (!navigator.requestMIDIAccess) {
      throw new Error('Seu navegador não suporta a API Web MIDI. Para uma lista de navegadores compatíveis, veja https://caniuse.com/midi');
    }

    this.access = await navigator
      .requestMIDIAccess({ sysex: false })
      .catch((error) => error);

    if (this.access === null) {
      throw new Error('Não foi possível acessar os dispositivos MIDI.');
    }

    const inputIds = [...this.access.inputs.keys()];

    if (inputIds.length > 0 && this.activeMidiInputId === null) {
      this.activeMidiInputId = inputIds[0];
    }

    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (input.id !== this.activeMidiInputId) return;

        const { data } = event;
        if (!data) {
          console.error('MIDI message has no data');
          return;
        }

        const statusByte = data[0];
        const channel = statusByte & 0x0f;
        const messageType = statusByte & 0xf0;

        if (messageType === 0xb0) { // Control Change
          const detail: ControlChange = { cc: data[1], value: data[2], channel };
          this.dispatchEvent(
            new CustomEvent<ControlChange>('cc-message', { detail }),
          );
        } else if (messageType === 0xe0) { // Pitch Bend
          const lsb = data[1];
          const msb = data[2];
          const rawValue = (msb << 7) | lsb; // 14-bit value (0-16383)
          const normalizedValue = (rawValue - 8192) / 8192; // map to -1.0 to 1.0
          this.dispatchEvent(
            new CustomEvent<number>('pitch-bend-message', { detail: normalizedValue }),
          );
        }
      };
    }

    return inputIds;
  }

  getDeviceName(id: string): string | null {
    if (!this.access) {
      return null;
    }
    const input = this.access.inputs.get(id);
    return input ? input.name : null;
  }
}