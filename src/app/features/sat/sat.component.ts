import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PeriodoActivoService } from '../../core/services/periodo-activo.service';

@Component({
  standalone: false,
  selector: 'app-sat',
  templateUrl: './sat.component.html',
})
export class SatComponent implements OnInit {
  tabParams: Record<string, number> = {};

  constructor(private route: ActivatedRoute, private periodoActivoService: PeriodoActivoService) {}

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
  }
}
