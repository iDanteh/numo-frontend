import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideArrowLeftRight,
  LucideCreditCard,
  LucideReceiptText,
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
  LucideTriangleAlert,
  LucideBanknote,
} from '@lucide/angular';
import { SharedModule } from '../../shared/shared.module';
import { LealtadRoutingModule } from './lealtad-routing.module';

import { LealtadShellComponent } from './shell/lealtad-shell.component';
import { TarjetasListComponent } from './tarjetas/tarjetas-list.component';
import { TarjetaDetailComponent } from './tarjetas/tarjeta-detail.component';
import { TarjetaCreateModalComponent } from './tarjetas/tarjeta-create-modal.component';
import { MovimientoModalComponent } from './tarjetas/movimiento-modal.component';
import { ImportarClientesComponent } from './importar-clientes/importar-clientes.component';
import { ClientesPendientesComponent } from './clientes-pendientes/clientes-pendientes.component';
import { LealtadReportesPanelComponent } from './reportes/lealtad-reportes-panel.component';
import { VentasFallidasLealtadComponent } from './ventas-fallidas/ventas-fallidas.component';
import { VentasCanceladasAuditoriaLealtadComponent } from './ventas-canceladas-auditoria/ventas-canceladas-auditoria.component';
import { AuditoriaLealtadComponent } from './auditoria/auditoria-lealtad.component';

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
    ImportarClientesComponent,
    ClientesPendientesComponent,
    LealtadReportesPanelComponent,
    VentasFallidasLealtadComponent,
    VentasCanceladasAuditoriaLealtadComponent,
    AuditoriaLealtadComponent,
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
    // ADMINISTRACION_NAV (compartido), así que también necesita su ícono acá. Reusado también
    // (2026-11-13) para el ítem de sidebar "Auditoría" (loyalty:auditoria/loyalty:config).
    // LucideUpload: ítem de sidebar "Importar clientes" (migración de clientes
    // legados "Club Tuberos", loyalty:importar).
    // LucideClock: ítem de sidebar "Clientes pendientes" (clientes legados sin
    // teléfono — loyalty_pending_enrollments, decisión de negocio 2026-10-19).
    // LucideReceiptText: espacio "Kiosco de facturación" del SpaceSwitcher (mismo gotcha de injector).
    // LucideTriangleAlert: ítem de sidebar "Ventas fallidas (Kore)" (webhook de venta sin procesar).
    // LucideBanknote: ítem de sidebar "Ventas canceladas (con depósito)" — reversiones de puntos
    // por venta de Kore cancelada que tenían un depósito bancario real relacionado.
    provideLucideIcons(
      LucideArrowLeftRight,
      LucideCreditCard,
      LucideReceiptText,
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
      LucideTriangleAlert,
      LucideBanknote,
    ),
  ],
})
export class LealtadModule {}
