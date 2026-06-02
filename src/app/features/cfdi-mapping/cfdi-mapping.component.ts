import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CfdiMappingService, CfdiMappingRule, MigrarPpdDescuentoResult } from '../../core/services/cfdi-mapping.service';
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

  readonly metodosPago = [
    { value: '',    label: 'Cualquiera' },
    { value: 'PUE', label: 'PUE — Pago en una sola exhibición' },
    { value: 'PPD', label: 'PPD — Pago en parcialidades o diferido' },
  ];

  readonly tasasIva = [
    { value: '',      label: 'Cualquiera' },
    { value: '16',    label: '16% — Tasa general' },
    { value: '0',     label: '0% — Tasa cero / exento' },
    { value: 'mixto', label: 'Mixto — 16% + 0% en el mismo CFDI' },
  ];

  constructor(
    private svc:   CfdiMappingService,
    private toast: ToastService,
    private fb:    FormBuilder,
  ) {
    this.ruleForm = this.fb.group({
      nombre:              ['', Validators.required],
      prioridad:           [10, [Validators.required, Validators.min(1)]],
      // Filtros
      tipoComprobante:     [null],
      metodoPago:          [null],
      formaPago:           [''],
      rfcEmisor:           [''],
      rfcReceptor:         [''],
      tasaIva:             [null],
      tieneDescuento:      [null],
      claveProdServ:       [''],
      tipoRelacion:        [''],
      relacionadoTipo:     [null],
      conceptoContiene:    [''],
      // Cuentas principales
      cuentaCargo:         ['', Validators.required],
      cuentaAbono:         ['', Validators.required],
      // IVA
      cuentaIva:           [''],
      cuentaIvaPPD:        [''],
      cuentaIvaRetenido:   [''],
      cuentaIsrRetenido:   [''],
      cuentaIvaAnticipo:   [''],
      // Adicionales
      cuentaAbono2:        [''],
      cuentaCargo2:        [''],
      cuentaDeltaAnticipo: [''],
      cuentaDescuento:     [''],
      cuentaDescuento0:    [''],
      // Flags
      ivaHaber:            [null],
      esAplicacionSaldo:   [null],
      // Otros
      centroCosto:         [''],
      isActive:            [true],
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
      nombre: '', prioridad: 10, isActive: true,
      tipoComprobante: null, metodoPago: null, formaPago: '',
      rfcEmisor: '', rfcReceptor: '', tasaIva: null, tieneDescuento: null,
      claveProdServ: '', tipoRelacion: '', relacionadoTipo: null, conceptoContiene: '',
      cuentaCargo: '', cuentaAbono: '',
      cuentaIva: '', cuentaIvaPPD: '', cuentaIvaRetenido: '', cuentaIsrRetenido: '',
      cuentaIvaAnticipo: '', cuentaAbono2: '', cuentaCargo2: '',
      cuentaDeltaAnticipo: '', cuentaDescuento: '', cuentaDescuento0: '',
      ivaHaber: null, esAplicacionSaldo: null, centroCosto: '',
    });
    this.showModal = true;
  }

  openEdit(rule: CfdiMappingRule): void {
    this.editingId  = rule.id ?? null;
    this.modalError = null;
    this.ruleForm.patchValue({
      nombre:              rule.nombre,
      prioridad:           rule.prioridad,
      isActive:            rule.isActive,
      tipoComprobante:     rule.tipoComprobante     ?? null,
      metodoPago:          rule.metodoPago           ?? null,
      formaPago:           rule.formaPago             ?? '',
      rfcEmisor:           rule.rfcEmisor             ?? '',
      rfcReceptor:         rule.rfcReceptor           ?? '',
      tasaIva:             rule.tasaIva               ?? null,
      tieneDescuento:      rule.tieneDescuento        ?? null,
      claveProdServ:       rule.claveProdServ         ?? '',
      tipoRelacion:        rule.tipoRelacion           ?? '',
      relacionadoTipo:     rule.relacionadoTipo       ?? null,
      conceptoContiene:    rule.conceptoContiene      ?? '',
      cuentaCargo:         rule.cuentaCargo,
      cuentaAbono:         rule.cuentaAbono,
      cuentaIva:           rule.cuentaIva             ?? '',
      cuentaIvaPPD:        rule.cuentaIvaPPD          ?? '',
      cuentaIvaRetenido:   rule.cuentaIvaRetenido     ?? '',
      cuentaIsrRetenido:   rule.cuentaIsrRetenido     ?? '',
      cuentaIvaAnticipo:   rule.cuentaIvaAnticipo     ?? '',
      cuentaAbono2:        rule.cuentaAbono2           ?? '',
      cuentaCargo2:        rule.cuentaCargo2           ?? '',
      cuentaDeltaAnticipo: rule.cuentaDeltaAnticipo   ?? '',
      cuentaDescuento:     rule.cuentaDescuento       ?? '',
      cuentaDescuento0:    rule.cuentaDescuento0      ?? '',
      ivaHaber:            rule.ivaHaber               ?? null,
      esAplicacionSaldo:   rule.esAplicacionSaldo     ?? null,
      centroCosto:         rule.centroCosto             ?? '',
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
    const str = (v: string | null | undefined) => v?.trim() || null;
    const data: CfdiMappingRule = {
      ...raw,
      tipoComprobante:     raw.tipoComprobante     || null,
      metodoPago:          raw.metodoPago           || null,
      formaPago:           str(raw.formaPago),
      rfcEmisor:           str(raw.rfcEmisor),
      rfcReceptor:         str(raw.rfcReceptor),
      tasaIva:             raw.tasaIva             || null,
      tieneDescuento:      raw.tieneDescuento      ?? null,
      claveProdServ:       str(raw.claveProdServ),
      tipoRelacion:        str(raw.tipoRelacion),
      relacionadoTipo:     raw.relacionadoTipo     || null,
      conceptoContiene:    str(raw.conceptoContiene),
      cuentaIva:           str(raw.cuentaIva),
      cuentaIvaPPD:        str(raw.cuentaIvaPPD),
      cuentaIvaRetenido:   str(raw.cuentaIvaRetenido),
      cuentaIsrRetenido:   str(raw.cuentaIsrRetenido),
      cuentaIvaAnticipo:   str(raw.cuentaIvaAnticipo),
      cuentaAbono2:        str(raw.cuentaAbono2),
      cuentaCargo2:        str(raw.cuentaCargo2),
      cuentaDeltaAnticipo: str(raw.cuentaDeltaAnticipo),
      cuentaDescuento:     str(raw.cuentaDescuento),
      cuentaDescuento0:    str(raw.cuentaDescuento0),
      ivaHaber:            raw.ivaHaber           ?? null,
      esAplicacionSaldo:   raw.esAplicacionSaldo  ?? null,
      centroCosto:         str(raw.centroCosto),
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
