import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ComparisonFacade } from '../../../core/facades';

export interface PeriodoSeleccionado {
  ejercicio: number;
  periodo: number;
  nombrePeriodo: string;
}

interface MesItem {
  numero: number;
  nombre: string;
  existe: boolean;
}

@Component({
  standalone: false,
  selector: 'app-selector-periodo-modal',
  templateUrl: './selector-periodo-modal.component.html',
})
export class SelectorPeriodoModalComponent implements OnInit, OnDestroy {
  @Output() periodoConfirmado = new EventEmitter<PeriodoSeleccionado>();
  @Output() cerrado = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  paso = 1;
  cargando = false;
  guardando = false;
  error = '';

  ejercicios: number[] = [];
  ejercicioSeleccionado?: number;
  periodoSeleccionado?: number;
  readonly anioNuevo = new Date().getFullYear();
  nuevoAnio: number = new Date().getFullYear();

  private allPeriodos: { ejercicio: number; periodo: number }[] = [];

  meses: MesItem[] = [
    { numero: 1,  nombre: 'Enero',      existe: false },
    { numero: 2,  nombre: 'Febrero',    existe: false },
    { numero: 3,  nombre: 'Marzo',      existe: false },
    { numero: 4,  nombre: 'Abril',      existe: false },
    { numero: 5,  nombre: 'Mayo',       existe: false },
    { numero: 6,  nombre: 'Junio',      existe: false },
    { numero: 7,  nombre: 'Julio',      existe: false },
    { numero: 8,  nombre: 'Agosto',     existe: false },
    { numero: 9,  nombre: 'Septiembre', existe: false },
    { numero: 10, nombre: 'Octubre',    existe: false },
    { numero: 11, nombre: 'Noviembre',  existe: false },
    { numero: 12, nombre: 'Diciembre',  existe: false },
  ];

  constructor(private comparisonFacade: ComparisonFacade) {}

  ngOnInit(): void {
    this.cargando = true;
    this.comparisonFacade.listPeriodosFiscales().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const items: { ejercicio: number; periodo: number | null }[] = res.data || [];
        this.ejercicios = [...new Set(items.map(p => p.ejercicio))].sort((a, b) => b - a);
        this.allPeriodos = items
          .filter(p => p.periodo !== null)
          .map(p => ({ ejercicio: p.ejercicio, periodo: p.periodo as number }));
        this.cargando = false;
      },
      error: () => { this.cargando = false; },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  seleccionarEjercicio(anio: number): void {
    this.ejercicioSeleccionado = anio;
    this.periodoSeleccionado = undefined;
    const existentes = this.allPeriodos
      .filter(p => p.ejercicio === anio)
      .map(p => p.periodo);
    this.meses = this.meses.map(m => ({ ...m, existe: existentes.includes(m.numero) }));
    this.paso = 2;
  }

  crearEjercicio(anio: number): void {
    if (this.guardando) return;
    this.guardando = true;
    this.error = '';
    this.comparisonFacade.createPeriodoFiscal(anio, null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.guardando = false;
        if (!this.ejercicios.includes(anio)) {
          this.ejercicios = [anio, ...this.ejercicios].sort((a, b) => b - a);
        }
        this.seleccionarEjercicio(anio);
      },
      error: (err) => {
        this.guardando = false;
        if (err?.status === 409) {
          // Already exists — just select it
          if (!this.ejercicios.includes(anio)) this.ejercicios = [anio, ...this.ejercicios];
          this.seleccionarEjercicio(anio);
        } else {
          this.error = err?.error?.error ?? 'Error al crear el ejercicio';
        }
      },
    });
  }

  seleccionarOCrearPeriodo(mes: MesItem): void {
    if (!this.ejercicioSeleccionado || this.guardando) return;
    if (mes.existe) {
      this.periodoSeleccionado = mes.numero;
      this.paso = 3;
      return;
    }
    this.guardando = true;
    this.error = '';
    this.comparisonFacade.createPeriodoFiscal(this.ejercicioSeleccionado, mes.numero).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.guardando = false;
        mes.existe = true;
        this.allPeriodos.push({ ejercicio: this.ejercicioSeleccionado!, periodo: mes.numero });
        this.periodoSeleccionado = mes.numero;
        this.paso = 3;
      },
      error: (err) => {
        this.guardando = false;
        if (err?.status === 409) {
          mes.existe = true;
          this.periodoSeleccionado = mes.numero;
          this.paso = 3;
        } else {
          this.error = err?.error?.error ?? 'Error al crear el periodo';
        }
      },
    });
  }

  confirmar(): void {
    if (!this.ejercicioSeleccionado || !this.periodoSeleccionado) return;
    this.periodoConfirmado.emit({
      ejercicio: this.ejercicioSeleccionado,
      periodo: this.periodoSeleccionado,
      nombrePeriodo: this.getNombreMes(this.periodoSeleccionado),
    });
  }

  getNombreMes(numero?: number): string {
    return this.meses.find(m => m.numero === numero)?.nombre ?? '';
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
