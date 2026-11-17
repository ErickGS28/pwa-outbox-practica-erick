// Mini-wrapper promisificado de IndexedDB (sin librerias).
// Se carga con <script> en index.html y con importScripts() en sw.js.

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// Abre la BD. onupgradeneeded es el unico lugar donde se puede crear el Object Store.
function abrirDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// CREATE: se resuelve en tx.oncomplete, cuando el dato ya quedo confirmado en disco.
function guardarRegistro(datos) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      let idGenerado;
      const req = store.add(datos);
      req.onsuccess = (event) => {
        idGenerado = event.target.result;
      };

      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// READ: transaccion 'readonly', permite lecturas simultaneas.
function obtenerTodosLosRegistros() {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

// UPDATE: get + put dentro de la misma transaccion 'readwrite'.
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const reqGet = store.get(id);
      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error('No se encontro el registro con ID: ' + id));
          return;
        }
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// DELETE por llave primaria.
function eliminarRegistro(id) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}
