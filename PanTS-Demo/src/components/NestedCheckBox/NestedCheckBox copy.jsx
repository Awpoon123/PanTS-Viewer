import { APP_CONSTANTS } from '../../helpers/constants';
import './NestedCheckBox.css';
import React, { useEffect, useState } from 'react';

function ChipBox({ itemData, checkStateProp, update, rgbaVals }) {
  const isChecked = checkStateProp[itemData.id];
  const label = itemData.label;
  const backgroundColor = `rgba(${rgbaVals.slice(0, 3).join(',')}, 0.8)`;

  return (
    <div className="organ-chip" style={{ backgroundColor }}>
      {label}
      {isChecked ? (
        <div className="chip-close" onClick={() => update(itemData.id, false)}>×</div>
      ) : (
        <div className="chip-add" onClick={() => update(itemData.id, true)}>＋</div>
      )}
    </div>
  );
}

function NestedCheckBox({ checkBoxData, checkState, update, innerRef, sessionId }) {
  const [searchText, setSearchText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [labelColorMap, setLabelColorMap] = useState({});
  const cacheKey = `labelColorMap_${sessionId}`;

  // Load color map from backend or sessionStorage
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
          parsedMap[labelId] = [
            color.R,
            color.G,
            color.B,
            color.A ?? 255
          ];
          console.log(`🎨 Label ${labelId} color: R=${color.R}, G=${color.G}, B=${color.B}, A=${color.A ?? 255}`);
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

  const handleRefreshColorMap = () => {
    sessionStorage.removeItem(cacheKey);
    fetchColorMap(true);
  };

  const normalizedSearch = searchText.trim().toLowerCase();

  const unselectedItems = checkBoxData.filter(item => !checkState[item.id]);
  const selectedItems = checkBoxData.filter(item => !!checkState[item.id]);

  const filteredUnselectedItems = unselectedItems.filter(item =>
    normalizedSearch === "" ? true : item.label.toLowerCase().includes(normalizedSearch)
  );

  return (
    <div className="NestedCheckBox" style={{ display: "block" }} ref={innerRef}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          placeholder="Search organs..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          className="search-box"
        />


        {showSuggestions && (
          <div className="checkbox-grid">
            {filteredUnselectedItems.map(item => (
              <ChipBox
                key={`suggest-${item.id}`}
                itemData={item}
                checkStateProp={checkState}
                update={update}
                rgbaVals={labelColorMap[item.id] || [150, 150, 150, 255]}
              />
            ))}
          </div>
        )}
      </div>

      <div className="checkbox-grid">
        {selectedItems.length > 0 && (
          <>
            <div className="divider-line"></div>
            {selectedItems.map(item => (
              <ChipBox
                key={`selected-${item.id}`}
                itemData={item}
                checkStateProp={checkState}
                update={update}
                rgbaVals={labelColorMap[item.id] || [150, 150, 150, 255]}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default NestedCheckBox;
