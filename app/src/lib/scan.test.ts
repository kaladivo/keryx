import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scanQr } from './scan';

const { scanBarcode } = vi.hoisted(() => ({ scanBarcode: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
vi.mock('@capacitor/barcode-scanner', () => ({
  CapacitorBarcodeScanner: { scanBarcode },
  CapacitorBarcodeScannerTypeHint: { QR_CODE: 0 },
}));

describe('iOS scanner', () => {
  beforeEach(() => { scanBarcode.mockReset(); });

  it('returns the decoded company link', async () => {
    scanBarcode.mockResolvedValue({ ScanResult: 'https://example.com/join' });
    expect(await scanQr()).toBe('https://example.com/join');
    expect(scanBarcode).toHaveBeenCalledWith(expect.objectContaining({ hint: 0 }));
  });

  it('treats cancellation as no result', async () => {
    scanBarcode.mockRejectedValue(Object.assign(new Error('Cancelled'), { code: 'OS-PLUG-BARC-0006' }));
    expect(await scanQr()).toBeNull();
  });

  it('preserves camera failures so the UI offers the paste-link fallback', async () => {
    const denied = Object.assign(new Error('Camera denied'), { code: 'OS-PLUG-BARC-0007' });
    scanBarcode.mockRejectedValue(denied);
    await expect(scanQr()).rejects.toBe(denied);
  });
});
