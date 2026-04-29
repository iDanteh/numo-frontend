import { Component, OnInit } from '@angular/core';
import { EntityService, Entity, EntityPayload } from '../../core/services/entity.service';

@Component({
  standalone: false,
  selector: 'app-entities',
  templateUrl: './entities.component.html',
})
export class EntitiesComponent implements OnInit {

  entities: Entity[] = [];
  loading  = false;
  error:   string | null = null;
  saving:  Record<number, boolean> = {};

  modal: {
    show:   boolean;
    mode:   'create' | 'edit';
    id:     number | null;
    rfc:    string;
    nombre: string;
    tipo:   'moral' | 'fisica';
    isActive:      boolean;
    autoSync:      boolean;
    syncEmitidos:  boolean;
    syncRecibidos: boolean;
    error:  string | null;
    saving: boolean;
  } = this.emptyModal();

  constructor(private entitySvc: EntityService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error   = null;
    this.entitySvc.list().subscribe({
      next:  (data) => { this.entities = data; this.loading = false; },
      error: (err)  => { this.error = err?.error?.error || 'Error al cargar entidades'; this.loading = false; },
    });
  }

  private emptyModal() {
    return {
      show: false, mode: 'create' as 'create' | 'edit',
      id: null as number | null,
      rfc: '', nombre: '', tipo: 'moral' as 'moral' | 'fisica', isActive: true,
      autoSync: true, syncEmitidos: true, syncRecibidos: false,
      error: null as string | null, saving: false,
    };
  }

  openCreate(): void {
    this.modal = this.emptyModal();
    this.modal.show = true;
  }

  openEdit(e: Entity): void {
    this.modal = {
      show: true, mode: 'edit',
      id:     e.id,
      rfc:    e.rfc,
      nombre: e.nombre,
      tipo:   e.tipo ?? 'moral',
      isActive:      e.isActive,
      autoSync:      e.syncConfig?.autoSync      ?? false,
      syncEmitidos:  e.syncConfig?.syncEmitidos  ?? true,
      syncRecibidos: e.syncConfig?.syncRecibidos ?? false,
      error: null, saving: false,
    };
  }

  closeModal(): void { this.modal.show = false; }

  save(): void {
    this.modal.error  = null;
    this.modal.saving = true;

    const payload: EntityPayload = {
      rfc:    this.modal.rfc.trim().toUpperCase(),
      nombre: this.modal.nombre.trim(),
      tipo:   this.modal.tipo,
      isActive: this.modal.isActive,
      syncConfig: {
        autoSync:      this.modal.autoSync,
        syncEmitidos:  this.modal.syncEmitidos,
        syncRecibidos: this.modal.syncRecibidos,
      },
    };

    const obs = this.modal.mode === 'create'
      ? this.entitySvc.create(payload)
      : this.entitySvc.update(this.modal.id!, payload);

    obs.subscribe({
      next: (saved) => {
        this.modal.saving = false;
        this.modal.show   = false;
        if (this.modal.mode === 'create') {
          this.entities = [...this.entities, saved];
        } else {
          this.entities = this.entities.map(e => e.id === saved.id ? saved : e);
        }
      },
      error: (err) => {
        this.modal.saving = false;
        this.modal.error  = err?.error?.error || 'Error al guardar';
      },
    });
  }

  toggleActive(e: Entity): void {
    this.saving[e.id] = true;
    this.entitySvc.update(e.id, { isActive: !e.isActive }).subscribe({
      next: (updated) => {
        this.entities = this.entities.map(x => x.id === updated.id ? updated : x);
        delete this.saving[e.id];
      },
      error: (err) => {
        this.error = err?.error?.error || 'Error al actualizar estado';
        delete this.saving[e.id];
      },
    });
  }

  isSaving(id: number): boolean { return !!this.saving[id]; }

  get totalActivas():   number { return this.entities.filter(e => e.isActive).length; }
  get totalAutoSync():  number { return this.entities.filter(e => e.syncConfig?.autoSync).length; }

  lastSync(e: Entity): string {
    const ls = e.syncConfig?.lastSync;
    if (!ls) return 'Nunca';
    return new Date(ls).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }
}
