import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CfdiMappingService, CfdiMappingRule } from '../../core/services/cfdi-mapping.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: false,
  selector: 'app-cfdi-mapping',
  templateUrl: './cfdi-mapping.component.html',
})
export class CfdiMappingComponent implements OnInit {
  rules:   CfdiMappingRule[] = [];
  loading  = false;

  // ── Modal ──────────────────────────────────────────────────────────────────
  showModal  = false;
  editingId: number | null = null;
  saving     = false;
  modalError: string | null = null;
  ruleForm:   FormGroup;

  // ── Confirmación borrar ────────────────────────────────────────────────────
  showConfirm  = false;
  confirmRule: CfdiMappingRule | null = null;
  deleting     = false;

  readonly tiposCfdi = [
    { value: '',  label: 'Cualquiera (comodín)' },
    { value: 'I', label: 'I — Ingreso' },
    { value: 'E', label: 'E — Egreso' },
    { value: 'P', label: 'P — Pago (complemento)' },
  ];

  constructor(
    private svc:   CfdiMappingService,
    private toast: ToastService,
    private fb:    FormBuilder,
  ) {
    this.ruleForm = this.fb.group({
      nombre:            ['', Validators.required],
      tipoComprobante:   [null],
      rfcEmisor:         [''],
      cuentaCargo:       ['', Validators.required],
      cuentaAbono:       ['', Validators.required],
      cuentaIva:         [''],
      cuentaIvaPPD:      [''],
      cuentaIvaRetenido: [''],
      cuentaIsrRetenido: [''],
      centroCosto:       [''],
      prioridad:         [10, [Validators.required, Validators.min(1)]],
      isActive:          [true],
    });
  }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.svc.listRules().subscribe({
      next:  (r) => { this.rules = r; this.loading = false; },
      error: () => { this.loading = false; this.toast.error('Error al cargar reglas'); },
    });
  }

  // ── Abrir modal ────────────────────────────────────────────────────────────
  openCreate(): void {
    this.editingId  = null;
    this.modalError = null;
    this.ruleForm.reset({
      nombre: '', tipoComprobante: null, rfcEmisor: '',
      cuentaCargo: '', cuentaAbono: '', cuentaIva: '',
      cuentaIvaPPD: '', cuentaIvaRetenido: '', cuentaIsrRetenido: '',
      centroCosto: '', prioridad: 10, isActive: true,
    });
    this.showModal = true;
  }

  openEdit(rule: CfdiMappingRule): void {
    this.editingId  = rule.id ?? null;
    this.modalError = null;
    this.ruleForm.patchValue({
      nombre:            rule.nombre,
      tipoComprobante:   rule.tipoComprobante ?? null,
      rfcEmisor:         rule.rfcEmisor         ?? '',
      cuentaCargo:       rule.cuentaCargo,
      cuentaAbono:       rule.cuentaAbono,
      cuentaIva:         rule.cuentaIva          ?? '',
      cuentaIvaPPD:      rule.cuentaIvaPPD       ?? '',
      cuentaIvaRetenido: rule.cuentaIvaRetenido  ?? '',
      cuentaIsrRetenido: rule.cuentaIsrRetenido  ?? '',
      centroCosto:       rule.centroCosto         ?? '',
      prioridad:         rule.prioridad,
      isActive:          rule.isActive,
    });
    this.showModal = true;
  }

  closeModal(): void { this.showModal = false; }

  // ── Guardar ────────────────────────────────────────────────────────────────
  save(): void {
    if (this.saving || this.ruleForm.invalid) return;
    this.saving     = true;
    this.modalError = null;

    const raw = this.ruleForm.value;
    const data: CfdiMappingRule = {
      ...raw,
      tipoComprobante:   raw.tipoComprobante   || null,
      rfcEmisor:         raw.rfcEmisor?.trim()         || undefined,
      cuentaIva:         raw.cuentaIva?.trim()          || undefined,
      cuentaIvaPPD:      raw.cuentaIvaPPD?.trim()      || undefined,
      cuentaIvaRetenido: raw.cuentaIvaRetenido?.trim()  || undefined,
      cuentaIsrRetenido: raw.cuentaIsrRetenido?.trim()  || undefined,
      centroCosto:       raw.centroCosto?.trim()         || undefined,
    };

    const obs = this.editingId
      ? this.svc.updateRule(this.editingId, data)
      : this.svc.createRule(data);

    obs.subscribe({
      next: () => {
        this.saving    = false;
        this.showModal = false;
        this.toast.success(this.editingId ? 'Regla actualizada' : 'Regla creada');
        this.load();
      },
      error: (err) => {
        this.saving     = false;
        this.modalError = err?.error?.error || 'Error al guardar';
      },
    });
  }

  // ── Borrar ─────────────────────────────────────────────────────────────────
  askDelete(rule: CfdiMappingRule): void {
    this.confirmRule = rule;
    this.showConfirm = true;
  }

  confirmDelete(): void {
    if (!this.confirmRule?.id) return;
    this.deleting = true;
    this.svc.deleteRule(this.confirmRule.id).subscribe({
      next: () => {
        this.deleting    = false;
        this.showConfirm = false;
        this.confirmRule = null;
        this.toast.success('Regla eliminada');
        this.load();
      },
      error: (err) => {
        this.deleting = false;
        this.toast.error(err?.error?.error || 'Error al eliminar');
      },
    });
  }

  cancelDelete(): void { this.showConfirm = false; this.confirmRule = null; }

  // ── Helpers ────────────────────────────────────────────────────────────────
  tipoLabel(t: string | null | undefined): string {
    return this.tiposCfdi.find(x => x.value === (t ?? ''))?.label ?? '—';
  }

  trackById(_: number, r: CfdiMappingRule): number | undefined { return r.id; }
}
