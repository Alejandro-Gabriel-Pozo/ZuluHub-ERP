/** Parte 4 de 4 de `TEXTOS_DE_FISCAL_CONFIGURACION` (`catalogo-fiscal-configuracion.ts`, que la reexporta): se partió para no pasar del tope de líneas. Ninguna clave ni texto cambió. */
export const TEXTOS_DE_FISCAL_CONFIGURACION_4 = {
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Organización».
  "fiscal.pantalla.config_cert_organizacion": {
    porDefecto: "Organización",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoGenerarPedido.cliente.tsx",
        nombre: "PasoGenerarPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Titular» (el dato, no el campo).
  "fiscal.pantalla.config_cert_titular": {
    porDefecto: "Titular",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "dato",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Vence» (la fecha va aparte, dd/mm/aaaa).
  "fiscal.pantalla.config_cert_vence": {
    porDefecto: "Vence",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "dato",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado.ts",
        nombre: "textoDeVence",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Pedido» (título del paso 2).
  "fiscal.pantalla.config_cert_pedido": {
    porDefecto: "Pedido",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "CLAVE_DEL_TITULO",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Copiar».
  "fiscal.pantalla.config_cert_copiar": {
    porDefecto: "Copiar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Descargar».
  "fiscal.pantalla.config_cert_descargar": {
    porDefecto: "Descargar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Certificado» (título del paso 3 y rótulo del campo de pegado).
  "fiscal.pantalla.config_cert_certificado": {
    porDefecto: "Certificado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "CLAVE_DEL_TITULO",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Cargar certificado».
  "fiscal.pantalla.config_cert_cargar": {
    porDefecto: "Cargar certificado",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "AsistenteDeCertificado",
      },
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoCargarCertificado.cliente.tsx",
        nombre: "PasoCargarCertificado",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Reemplazar».
  "fiscal.pantalla.config_cert_reemplazar": {
    porDefecto: "Reemplazar",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/AsistenteDeCertificado.cliente.tsx",
        nombre: "AsistenteDeCertificado",
      },
    ],
    fuente: "HEREDADO",
  },
  // Dueño, 2026-11-03, cuestionario «Certificado», textos nuevos: «Siguiente».
  "fiscal.pantalla.config_cert_siguiente": {
    porDefecto: "Siguiente",
    usos: [
      {
        como: "FUNCION",
        archivo: "apps/web/ui/plantillas/configuracion-fiscal/PasoDelPedido.cliente.tsx",
        nombre: "PasoDelPedido",
      },
    ],
    fuente: "HEREDADO",
  },
} as const;
