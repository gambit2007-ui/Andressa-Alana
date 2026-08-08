import { describe, expect, it } from 'vitest';
import { MAX_DEVICE_PHOTO_SIZE, selectValidDevicePhotos } from './devicePhotos';

const photo = (name: string, type: string, size = 1024) => ({ name, type, size });

describe('selectValidDevicePhotos', () => {
  it('aceita JPG e PNG dentro do limite', () => {
    const result = selectValidDevicePhotos(0, [photo('frente.jpg', 'image/jpeg'), photo('verso.png', 'image/png')]);
    expect(result.accepted).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it('rejeita formatos e arquivos acima de 8 MB', () => {
    const result = selectValidDevicePhotos(0, [
      photo('foto.webp', 'image/webp'),
      photo('grande.jpg', 'image/jpeg', MAX_DEVICE_PHOTO_SIZE + 1),
    ]);
    expect(result.accepted).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });

  it('respeita o limite total de seis fotos', () => {
    const result = selectValidDevicePhotos(5, [photo('uma.jpg', 'image/jpeg'), photo('duas.jpg', 'image/jpeg')]);
    expect(result.accepted.map((item) => item.name)).toEqual(['uma.jpg']);
    expect(result.errors[0]).toContain('6 fotos');
  });
});
