import { CollectionRequestService } from './collection-request.service';
import { ApiService } from './api.service';

// Sin TestBed a propósito — CollectionRequestService es una clase plana con una sola
// dependencia (ApiService), instanciarla directo con un mock es suficiente y evita el
// costo de levantar el módulo de testing de Angular para algo que no toca el DOM.
describe('CollectionRequestService#identificar', () => {
  let api: jasmine.SpyObj<ApiService>;
  let svc: CollectionRequestService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['patch']);
    svc = new CollectionRequestService(api);
  });

  it('camino feliz (1 solo movimiento): manda el atajo escalar {bankMovementId} tal cual, sin envolverlo en asignaciones', () => {
    svc.identificar('cr1', { bankMovementId: 'mov1' });

    expect(api.patch).toHaveBeenCalledWith('/collection-requests/cr1/identificar', { bankMovementId: 'mov1' });
  });

  it('reparto (2+ movimientos): manda {asignaciones} tal cual, sin transformar el payload', () => {
    const payload = {
      asignaciones: [
        { formaPagoDocId: 'fp1', bankMovementId: 'movA' },
        { formaPagoDocId: 'fp2', bankMovementId: 'movB' },
      ],
    };

    svc.identificar('cr1', payload);

    expect(api.patch).toHaveBeenCalledWith('/collection-requests/cr1/identificar', payload);
  });
});
