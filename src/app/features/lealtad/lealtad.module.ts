import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideArrowLeftRight,
  LucideCreditCard,
  LucideSettings,
  LucideUsers,
  LucideBuilding2,
  LucideActivity,
  LucideLayoutDashboard,
  LucideChevronDown,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucideFileSearch,
  LucideUpload,
  LucideClock,
} from '@lucide/angular';
import { SharedModule } from '../../shared/shared.module';
import { LealtadRoutingModule } from './lealtad-routing.module';

import { LealtadShellComponent } from './shell/lealtad-shell.component';
import { TarjetasListComponent } from './tarjetas/tarjetas-list.component';
import { TarjetaDetailComponent } from './tarjetas/tarjeta-detail.component';
import { TarjetaCreateModalComponent } from './tarjetas/tarjeta-create-modal.component';
import { MovimientoModalComponent } from './tarjetas/movimiento-modal.component';
import { NipRevealModalComponent } from './tarjetas/nip-reveal-modal.component';
import { ImportarClientesComponent } from './importar-clientes/importar-clientes.component';
import { ClientesPendientesComponent } from './clientes-pendientes/clientes-pendientes.component';
import { LealtadReportesPanelComponent } from './reportes/lealtad-reportes-panel.component';

// LealtadConfigComponent — 2026-10-16: ya NO se declara acá. Su ruta propia
// (/lealtad/configuracion) fue eliminada; el componente ahora vive en su
// propio LealtadConfigModule y se embebe dentro de ConfigAdminComponent
// ("Central de configuración" → sección "Lealtad"). Ver
// configuracion/lealtad-config.module.ts.

@NgModule({
  declarations: [
    LealtadShellComponent,
    TarjetasListComponent,
    TarjetaDetailComponent,
    TarjetaCreateModalComponent,
    MovimientoModalComponent,
    NipRevealModalComponent,
    ImportarClientesComponent,
    ClientesPendientesComponent,
    LealtadReportesPanelComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    SharedModule,
    LucideDynamicIcon,
    LealtadRoutingModule,
  ],
  providers: [
    // Íconos usados por lealtad-shell.component.html + Administración
    // (shared/config/administracion-nav.config.ts) — mismo criterio por
    // módulo que LayoutModule/BanksModule.
    // LucideLayoutDashboard + LucideChevronDown: sistema-lealtad —
    // SpaceSwitcherComponent (SharedModule) renderiza la entrada "NUMO" y su
    // chevron acá dentro; LealtadModule es lazy (injector propio), así que
    // necesita sus propios íconos aunque LayoutModule ya los provea para el
    // shell de Numo (LUCIDE_ICONS no es multi-provider, no se mergea entre
    // injectores).
    // LucidePanelLeft + LucidePanelLeftClose: sistema-lealtad — botón de
    // colapso del rail propio de LealtadShellComponent (mismo par de íconos
    // que ya usa SidebarComponent del lado Numo, mismo gotcha de injector).
    // LucideFileSearch: merge main->Lenin — "Monitor de Pólizas" se sumó a
    // ADMINISTRACION_NAV (compartido), así que también necesita su ícono acá.
    // LucideUpload: ítem de sidebar "Importar clientes" (migración de clientes
    // legados "Club Tuberos", loyalty:importar).
    // LucideClock: ítem de sidebar "Clientes pendientes" (clientes legados sin
    // teléfono — loyalty_pending_enrollments, decisión de negocio 2026-10-19).
    provideLucideIcons(
      LucideArrowLeftRight,
      LucideCreditCard,
      LucideSettings,
      LucideUsers,
      LucideBuilding2,
      LucideActivity,
      LucideLayoutDashboard,
      LucideChevronDown,
      LucidePanelLeft,
      LucidePanelLeftClose,
      LucideFileSearch,
      LucideUpload,
      LucideClock,
    ),
  ],
})
export class LealtadModule {}
