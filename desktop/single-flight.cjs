// Single-flight guard (pure): while one run is in progress, further requests join
// it instead of starting another. Used for the UI server restart.

function createSingleFlight() {
  let current = null;
  return {
    /** @returns {{joined: boolean, result: Promise<any>}} */
    run(task) {
      if (current) {
        return { joined: true, result: current };
      }
      // The marker clears before any awaiting caller resumes.
      current = Promise.resolve()
        .then(task)
        .finally(() => {
          current = null;
        });
      return { joined: false, result: current };
    },
    get busy() {
      return current !== null;
    },
  };
}

module.exports = { createSingleFlight };
