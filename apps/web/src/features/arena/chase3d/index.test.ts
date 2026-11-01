import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountChaseCam } from './index';

const start = vi.hoisted(() => vi.fn());
vi.mock('./scene3d', () => ({ startChaseCam: start }));

afterEach(() => start.mockReset());

const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

describe('mountChaseCam', () => {
  it('loads the 3D scene on mount and stops it on unmount', async () => {
    const stop = vi.fn();
    start.mockReturnValue(stop);
    const el = document.createElement('div');
    const getState = () => null;
    const unmount = mountChaseCam(el, getState);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0]).toBe(el);
    expect(start.mock.calls[0]![1]).toBe(getState);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when unmounted before the scene loads', async () => {
    const unmount = mountChaseCam(document.createElement('div'), () => null);
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(start).not.toHaveBeenCalled();
  });

  it('reports a failed start (no WebGL) so the caller falls back to 2D', async () => {
    const err = new Error('Error creating WebGL context.');
    start.mockImplementation(() => {
      throw err;
    });
    const onFail = vi.fn();
    mountChaseCam(document.createElement('div'), () => null, { onFail });
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledWith(err));
  });

  it('passes frame-loop failures on until unmounted', async () => {
    start.mockReturnValue(() => {});
    const onFail = vi.fn();
    const unmount = mountChaseCam(document.createElement('div'), () => null, { onFail });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    const fail = (start.mock.calls[0]![2] as { onFail: (e: unknown) => void }).onFail;
    fail('lost');
    expect(onFail).toHaveBeenCalledWith('lost');
    unmount();
    fail('late');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('keeps three out of the main bundle: only scene3d imports it, and only dynamically', () => {
    for (const file of ['./index.ts', './ChaseCam.tsx', './math.ts']) {
      const code = source(file);
      expect(code, file).not.toMatch(/from 'three'/);
      expect(code, file).not.toMatch(/^import (?!type ).*'\.\/scene3d'/m);
    }
    expect(source('./index.ts')).toMatch(/import\('\.\/scene3d'\)/);
  });
});
