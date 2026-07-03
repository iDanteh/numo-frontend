import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ViewChild, ElementRef, HostListener } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  BankService, BankRule, BankRuleCondicion,
  RuleCampo, RuleOperador, RuleAccion, RuleOcultarRol,
} from '../../../../core/services/bank.service';

@Component({
  standalone: false,
  selector: 'app-rules-panel',
  templateUrl: './rules-panel.component.html',
  styleUrls: ['./rules-panel.component.css'],
})
export class RulesPanelComponent implements OnInit, OnDestroy {
  @Input() activeBanco!: string;

  @Output() closed       = new EventEmitter<void>();
  @Output() rulesApplied = new EventEmitter<void>();

  @ViewChild('ruleNombreInput') ruleNombreInputRef?: ElementRef<HTMLInputElement>;

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.drawerVisible) this._startDrawerClose();
  }

  rules:          BankRule[] = [];
  rulesLoading    = false;
  applyingRules   = false;
  applyMode: 'all' | 'sinCategoria' | null = null;
  applyRulesResult: { actualizados: number; sinCambio: number } | null = null;
  applyRulesError: string | null = null;

  showDeleteRuleModal = false;
  ruleToDelete: BankRule | null = null;
  ruleActionResult: { type: 'update' | 'delete'; nombre: string; movCount: number } | null = null;

  showRuleForm  = false;
  drawerVisible = false;   // true mientras el drawer está montado (incluye animación de cierre)
  editingRuleId: string | null = null;
  ruleNombre    = '';
  ruleLogica:   'Y' | 'O' = 'Y';
  ruleAccion:   RuleAccion = 'categorizar';
  ruleMensajeBloqueo  = '';
  ruleEstadoDestino: 'no_identificado' | 'otros' | 'reclasificado' = 'no_identificado';
  ruleTambienCambiarEstado = false;
  ruleTambienOcultar       = false;
  ruleOcultarRoles: RuleOcultarRol[] = [];
  ruleCondiciones: { campo: RuleCampo; operador: RuleOperador; valor: string }[] = [];
  savingRule    = false;
  ruleError: string | null = null;

  readonly ROLES_OCULTAR: { value: RuleOcultarRol; label: string }[] = [
    { value: 'contabilidad', label: 'Contabilidad' },
    { value: 'cobranza',     label: 'Cobranza' },
  ];

  readonly CAMPOS_REGLA: { value: RuleCampo; label: string }[] = [
    { value: 'concepto',           label: 'Concepto' },
    { value: 'deposito',           label: 'Depósito' },
    { value: 'retiro',             label: 'Retiro' },
    { value: 'referenciaNumerica', label: 'Referencia' },
    { value: 'numeroAutorizacion', label: 'Autorización' },
  ];

  readonly OPERADORES_REGLA: { value: RuleOperador; label: string; numerico?: boolean }[] = [
    { value: 'contiene',    label: 'contiene' },
    { value: 'no_contiene', label: 'no contiene' },
    { value: 'igual',       label: 'igual a' },
    { value: 'empieza_con', label: 'empieza con' },
    { value: 'termina_con', label: 'termina con' },
    { value: 'mayor_que',   label: 'mayor que',     numerico: true },
    { value: 'menor_que',   label: 'menor que',     numerico: true },
    { value: 'mayor_igual', label: 'mayor o igual', numerico: true },
    { value: 'menor_igual', label: 'menor o igual', numerico: true },
  ];

  readonly ESTADOS_DESTINO_REGLA: { value: 'no_identificado' | 'otros' | 'reclasificado'; label: string }[] = [
    { value: 'no_identificado', label: 'No identificado' },
    { value: 'reclasificado',   label: 'Por conciliar' },
    { value: 'otros',           label: 'Otros' },
  ];

  private readonly OPS_NUMERICOS   = new Set(['mayor_que', 'menor_que', 'mayor_igual', 'menor_igual']);
  private readonly CAMPOS_NUMERICOS = new Set(['deposito', 'retiro']);

  private destroy$ = new Subject<void>();

  constructor(private bankService: BankService) {}

  ngOnInit(): void {
    this.loadRules();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadRules(): void {
    if (!this.activeBanco) return;
    this.rulesLoading = true;
    this.bankService.listRules(this.activeBanco).pipe(takeUntil(this.destroy$)).subscribe({
      next: (rules) => { this.rules = rules; this.rulesLoading = false; },
      error: ()     => { this.rulesLoading = false; },
    });
  }

  applyRules(soloSinCategoria = false): void {
    if (!this.activeBanco || this.applyingRules) return;
    this.applyingRules    = true;
    this.applyMode        = soloSinCategoria ? 'sinCategoria' : 'all';
    this.applyRulesResult = null;
    this.applyRulesError  = null;
    this.bankService.applyRules(this.activeBanco, soloSinCategoria)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.applyRulesResult = res;
          this.applyingRules    = false;
          this.applyMode        = null;
          this.rulesApplied.emit();
        },
        error: (err) => {
          this.applyRulesError = err?.error?.error || 'Error al aplicar reglas';
          this.applyingRules   = false;
          this.applyMode       = null;
        },
      });
  }

  openNewRule(): void {
    this.editingRuleId           = null;
    this.ruleNombre              = '';
    this.ruleLogica              = 'Y';
    this.ruleAccion              = 'categorizar';
    this.ruleMensajeBloqueo      = '';
    this.ruleEstadoDestino       = 'no_identificado';
    this.ruleTambienCambiarEstado = false;
    this.ruleTambienOcultar      = false;
    this.ruleOcultarRoles        = [];
    this.ruleCondiciones         = [{ campo: 'concepto', operador: 'contiene', valor: '' }];
    this.ruleError          = null;
    this.showRuleForm       = true;
    this.drawerVisible      = true;
    setTimeout(() => this.ruleNombreInputRef?.nativeElement.focus(), 60);
  }

  openEditRule(rule: BankRule): void {
    this.editingRuleId           = rule._id;
    this.ruleNombre              = rule.nombre;
    this.ruleLogica              = rule.logica;
    this.ruleAccion              = rule.accion ?? 'categorizar';
    this.ruleMensajeBloqueo      = rule.mensajeBloqueo ?? '';
    this.ruleEstadoDestino       = rule.estadoDestino  ?? 'no_identificado';
    this.ruleTambienCambiarEstado = rule.accion === 'categorizar' && !!rule.estadoDestino;
    this.ruleOcultarRoles        = [...(rule.ocultarRoles ?? [])];
    this.ruleTambienOcultar      = rule.accion === 'categorizar' && this.ruleOcultarRoles.length > 0;
    this.ruleCondiciones         = rule.condiciones.map(c => ({ ...c }));
    this.ruleError          = null;
    this.showRuleForm       = true;
    this.drawerVisible      = true;
    setTimeout(() => this.ruleNombreInputRef?.nativeElement.focus(), 60);
  }

  private _startDrawerClose(): void {
    this.drawerVisible = false;
    // Espera a que termine la animación CSS (200ms) antes de destruir el DOM
    setTimeout(() => {
      this.showRuleForm  = false;
      this.editingRuleId = null;
      this.ruleError     = null;
    }, 200);
  }

  cancelRuleForm(): void {
    this._startDrawerClose();
  }

  toggleOcultarRole(value: RuleOcultarRol): void {
    const i = this.ruleOcultarRoles.indexOf(value);
    if (i === -1) this.ruleOcultarRoles.push(value);
    else this.ruleOcultarRoles.splice(i, 1);
  }

  addCondicion(): void {
    this.ruleCondiciones.push({ campo: 'concepto', operador: 'contiene', valor: '' });
  }

  removeCondicion(i: number): void {
    this.ruleCondiciones.splice(i, 1);
  }

  saveRule(): void {
    if (!this.activeBanco || this.savingRule) return;
    if (!this.ruleNombre.trim()) { this.ruleError = 'El nombre es requerido'; return; }
    if (this.ruleCondiciones.length === 0) { this.ruleError = 'Añade al menos una condición'; return; }
    if (this.ruleCondiciones.some(c => !c.valor.trim())) { this.ruleError = 'Todos los valores son requeridos'; return; }
    if (this.ruleCondiciones.some(c => this.OPS_NUMERICOS.has(c.operador) && isNaN(parseFloat(c.valor)))) {
      this.ruleError = 'Los operadores de comparación numérica requieren un valor numérico';
      return;
    }

    this.savingRule = true;
    this.ruleError  = null;

    const data: any = {
      nombre:      this.ruleNombre.trim(),
      logica:      this.ruleLogica,
      accion:      this.ruleAccion,
      condiciones: this.ruleCondiciones,
      orden:       this.editingRuleId
        ? (this.rules.find(r => r._id === this.editingRuleId)?.orden ?? 0)
        : this.rules.length,
    };
    // Siempre enviar explícitamente para que el backend no preserve valores anteriores
    data.mensajeBloqueo = (this.ruleAccion === 'bloquear_identificacion' && this.ruleMensajeBloqueo.trim())
      ? this.ruleMensajeBloqueo.trim()
      : null;

    data.estadoDestino = (this.ruleAccion === 'cambiar_estado' ||
                         (this.ruleAccion === 'categorizar' && this.ruleTambienCambiarEstado))
      ? this.ruleEstadoDestino
      : null;

    data.ocultarRoles = (this.ruleAccion === 'categorizar' && this.ruleTambienOcultar)
      ? this.ruleOcultarRoles
      : [];

    const req$ = this.editingRuleId
      ? this.bankService.updateRule(this.editingRuleId, data)
      : this.bankService.createRule(this.activeBanco, data);

    const nombre = data.nombre;
    req$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.savingRule = false;
        this._startDrawerClose();
        this.applyRulesResult = null;
        const movCount = (res as any)?.movSincronizados ?? 0;
        if (this.editingRuleId && movCount > 0) {
          this.ruleActionResult = { type: 'update', nombre, movCount };
        }
        this.loadRules();
      },
      error: (err) => {
        this.ruleError  = err?.error?.error || 'Error al guardar la regla';
        this.savingRule = false;
      },
    });
  }

  onDrop(event: CdkDragDrop<BankRule[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const snapshot = [...this.rules];
    moveItemInArray(this.rules, event.previousIndex, event.currentIndex);
    this.bankService.reorderRules(this.rules.map(r => r._id))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: () => { this.rules = snapshot; },
      });
  }

  openDeleteRuleModal(rule: BankRule): void {
    this.ruleToDelete        = rule;
    this.showDeleteRuleModal = true;
  }

  closeDeleteRuleModal(): void {
    this.showDeleteRuleModal = false;
    this.ruleToDelete        = null;
  }

  confirmDeleteRule(): void {
    if (!this.ruleToDelete) return;
    const { _id: id, nombre, accion } = this.ruleToDelete;
    this.closeDeleteRuleModal();
    this.bankService.deleteRule(id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.applyRulesResult = null;
        const movCount = res?.movRevertidos ?? 0;
        if (accion === 'categorizar' && movCount > 0) {
          this.ruleActionResult = { type: 'delete', nombre, movCount };
        }
        this.loadRules();
      },
    });
  }

  operadoresPara(campo: RuleCampo): { value: RuleOperador; label: string }[] {
    const numerico = this.CAMPOS_NUMERICOS.has(campo);
    return this.OPERADORES_REGLA.filter(op => numerico ? (op.numerico || op.value === 'igual') : !op.numerico);
  }

  onCampoChange(c: { campo: RuleCampo; operador: RuleOperador; valor: string }): void {
    const ops = this.operadoresPara(c.campo);
    if (!ops.find(o => o.value === c.operador)) c.operador = ops[0].value;
    c.valor = '';
  }

  getAccionHint(): string {
    const hints: Record<RuleAccion, string> = {
      categorizar:              'El nombre de la regla se asigna como categoría al movimiento',
      cambiar_estado:           'Mueve el movimiento al estado seleccionado cuando se apliquen las reglas',
      bloquear_identificacion:  'Impide marcar el movimiento como identificado; los admins pueden forzarlo',
    };
    return hints[this.ruleAccion] ?? '';
  }
}
