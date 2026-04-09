import { APP_CONSTANTS } from '../../helpers/constants';
import './NestedCheckBox.css';
import React, { useEffect, useRef, useState } from 'react';

function ChipBox({ itemData, checkStateProp, update, rgbaVals, onAdd }) {
  const isChecked = checkStateProp[itemData.id];
  const label = itemData.label;
  const colorRGB = `rgba(${rgbaVals.slice(0, 3).join(',')}, 1)`;

  return (
    <div
      className="organ-chip"
      style={{ borderColor: colorRGB }}
    >
      <div
        className="organ-dot"
        style={{ backgroundColor: colorRGB }}
      />
      <span className="organ-label">{label}</span>
      {isChecked ? (
        <div className="chip-button chip-close" onClick={() => update(itemData.id, false)}>×</div>
      ) : (
        <div className="chip-button chip-add" onClick={(e) => {
          e.stopPropagation();
          onAdd(itemData);
        }}>＋</div>
      )}
    </div>
  );
}

function NestedCheckBox({ checkBoxData, checkState, update, innerRef, sessionId }) {
  const [searchText, setSearchText] = useState("");
  const [showSuggestionsOnly, setShowSuggestionsOnly] = useState(true);
  const [showBackButton, setShowBackButton] = useState(true);
  const [labelColorMap, setLabelColorMap] = useState({});
  const cacheKey = `labelColorMap_${sessionId}`;

  const inputRef = useRef(null);
  const suggestionRef = useRef(null);

  const fetchColorMap = async (forceReload = false) => {
    try {
      if (!forceReload) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          setLabelColorMap(JSON.parse(cached));
          return;
        }
      }

      const response = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-label-colormap/${sessionId}`);
      const lut = await response.json();
      const parsedMap = {};

      for (const labelId in lut) {
        const color = lut[labelId];
        if (color && color.R !== undefined) {
          parsedMap[labelId] = [color.R, color.G, color.B, color.A ?? 255];
        }
      }

      sessionStorage.setItem(cacheKey, JSON.stringify(parsedMap));
      setLabelColorMap(parsedMap);
    } catch (err) {
      console.warn("❗ Failed to fetch colormap:", err);
    }
  };

  useEffect(() => {
    fetchColorMap();
  }, [sessionId]);

  const handleAddImmediate = (item) => {
    update(item.id, true);
  };

  const normalizedSearch = searchText.trim().toLowerCase();
  const unselectedItems = checkBoxData.filter(item => !checkState[item.id]);
  const selectedItems = checkBoxData.filter(item => !!checkState[item.id]);

  const filteredUnselectedItems = unselectedItems.filter(item =>
    normalizedSearch === "" ? true : item.label.toLowerCase().includes(normalizedSearch)
  );

  const handleFocusSearch = () => {
    setShowSuggestionsOnly(true);
    setShowBackButton(true);
  };

  const handleBackClick = () => {
    setShowSuggestionsOnly(false);
    setShowBackButton(false);
  };

  return (
    <div
      className="selected_checkbox-scroll-box"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
      ref={innerRef}
    >
      {/* Top fixed search area */}
      <div style={{ flexShrink: 0, padding: '8px', backgroundColor: '#030a1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="text"
            placeholder="Search organs..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={handleFocusSearch}
            className="search-box"
            ref={inputRef}
          />
          {showBackButton && (
            <button
              onClick={handleBackClick}
              style={{
                fontSize: "0.85rem",
                padding: "2px 6px",
                borderRadius: "4px",
                background: "#eee",
                border: "1px solid #ccc",
                cursor: "pointer"
              }}
            >
              ← Show Added
            </button>
          )}
        </div>
      </div>

      {/* Scrollable organ list */}
      <div style={{ flexGrow: 1, overflowY: 'auto', padding: '8px' }}>
        {showSuggestionsOnly ? (
          <div className="checkbox-grid" ref={suggestionRef}>
            {filteredUnselectedItems.map(item => (
              <ChipBox
                key={`suggest-${item.id}`}
                itemData={item}
                checkStateProp={checkState}
                update={update}
                onAdd={handleAddImmediate}
                rgbaVals={labelColorMap[item.id] || [150, 150, 150, 255]}
              />
            ))}
            {filteredUnselectedItems.length === 0 && (
              <div style={{ marginTop: "10px", color: "#555", fontStyle: "italic" }}>
                ✅ All organs are already added and displayed.
              </div>
            )}
          </div>
        ) : (
          selectedItems.length > 0 && (
            <div className="checkbox-grid">
              <div style={{ marginBottom: "8px", color: "#555", fontStyle: "italic" }}>
                ℹ️ Click × to remove organs from view.
              </div>
              <div className="divider-line"></div>
              {selectedItems.map(item => (
                <ChipBox
                  key={`selected-${item.id}`}
                  itemData={item}
                  checkStateProp={checkState}
                  update={update}
                  onAdd={() => {}}
                  rgbaVals={labelColorMap[item.id] || [150, 150, 150, 255]}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default NestedCheckBox;
