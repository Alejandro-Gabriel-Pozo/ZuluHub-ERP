import { ACCIONES_DE_LOTES } from "./catalogo-lotes-y-produccion";

export const MODULO_DE_STOCK = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["catalogo"],
  usaSiExiste: [],
  // El primer depósito lo crea la persona usuaria: stock no pide datos previos.
  datosRequeridos: [],
  implementadoPor: ["modulos/stock"],
  acciones: {
    "stock.ver": { capacidad: null, efecto: "LECTURA" },
    "stock.verificar_saldos": { capacidad: null, efecto: "LECTURA" },
    // E5-T10 (P-1, DECIDIDO): quien puede ver costos es el gerente y el administrador; sin esta acción cualquiera con `stock.ver` los vería.
    "costos.ver": { capacidad: null, efecto: "LECTURA" },
    "stock.registrar_entrada": { capacidad: null, efecto: "CREA_AMPLIA" },
    "stock.registrar_salida": { capacidad: null, efecto: "CREA_AMPLIA" },
    "stock.transferir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "stock.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "stock.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "depositos.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "depositos.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "depositos.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "depositos.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "articulos.controlar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "articulos.dejar_de_controlar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "composiciones.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "conteos.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "conteos.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "conteos.aplicar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "conteos.cancelar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    ...ACCIONES_DE_LOTES,
  },
} as const;
