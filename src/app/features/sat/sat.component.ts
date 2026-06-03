import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';
import { SatService } from '../../core/services/sat.service';
import { CheckpointIncompleto } from '../../core/models/sat.model';

@Component({
  standalone: false,
  selector: 'app-sat',
  templateUrl: './sat.component.html',
})
export class SatComponent implements OnInit {
  tabParams: Record<string, number> = {};
  checkpointsIncompletos: CheckpointIncompleto[] = [];
  alertaColapsada = true;

  constructor(
    private route: ActivatedRoute,
    private periodoActivoService: PeriodoActivoService,
    private satService: SatService,
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const ej = qp.get('ejercicio');
    const pe = qp.get('periodo');
    if (ej) {
      this.tabParams['ejercicio'] = parseInt(ej);
      if (pe) this.tabParams['periodo'] = parseInt(pe);
    } else {
      const saved = this.periodoActivoService.snapshot;
      if (saved.ejercicio != null) {
        this.tabParams['ejercicio'] = saved.ejercicio;
        if (saved.periodo != null) this.tabParams['periodo'] = saved.periodo;
      }
    }
    this.satService.getCheckpointsSalud(45).subscribe({
      next: res => { this.checkpointsIncompletos = res.incompletos ?? []; },
      error: () => {},
    });
  }
}
